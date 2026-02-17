import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import "./App.css";

const socket = io("https://webrtcbackend-production-0dc3.up.railway.app", {
  transports: ["websocket", "polling"],
});

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export default function App() {
  const [myCode, setMyCode] = useState("");
  const [targetCode, setTargetCode] = useState("");
  const [incomingCall, setIncomingCall] = useState(null);
  const [inCall, setInCall] = useState(false);
  const [status, setStatus] = useState("Idle");
  const [isMuted, setIsMuted] = useState(false);
  
  // Speaker Selection States
  const [outputs, setOutputs] = useState([]);
  const [selectedOutput, setSelectedOutput] = useState("");
  const [canSwitchSpeaker, setCanSwitchSpeaker] = useState(false);

  const pcRef = useRef(null);
  const remoteAudioRef = useRef();
  const localStreamRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const targetCodeRef = useRef("");

  function createPeerConnection() {
    if (pcRef.current) pcRef.current.close();
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (e) => {
      if (e.candidate && targetCodeRef.current) {
        socket.emit("ice-candidate", { to: targetCodeRef.current, candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = e.streams[0];
        remoteAudioRef.current.play().catch(console.error);
      }
    };

    pc.onconnectionstatechange = () => {
      setStatus(pc.connectionState);
      if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        cleanupCall();
      }
    };

    return pc;
  }

  useEffect(() => {
    pcRef.current = createPeerConnection();
    
    // Check if browser even supports speaker switching
    if (HTMLAudioElement.prototype.setSinkId) {
      setCanSwitchSpeaker(true);
    }

    socket.on("your-code", setMyCode);
    socket.on("incoming-call", ({ from, offer }) => setIncomingCall({ from, offer }));
    socket.on("call-rejected", () => { alert("Call Rejected"); cleanupCall(); });
    socket.on("call-ended", cleanupCall);
    socket.on("call-accepted", handleCallAccepted);
    socket.on("ice-candidate", handleIceCandidate);

    return () => { socket.off(); pcRef.current?.close(); };
  }, []);

  async function handleCallAccepted({ answer }) {
    try {
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      while (pendingCandidatesRef.current.length > 0) {
        await pcRef.current.addIceCandidate(pendingCandidatesRef.current.shift());
      }
      setInCall(true);
    } catch (e) { console.error(e); }
  }

  async function handleIceCandidate(candidate) {
    if (pcRef.current?.remoteDescription) {
      await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
    } else {
      pendingCandidatesRef.current.push(candidate);
    }
  }

  // REFRESH SPEAKERS: Crucial to call this after Mic permission is granted
  async function refreshDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioOutputs = devices.filter(d => d.kind === "audiooutput" && d.deviceId !== "default");
      setOutputs(audioOutputs);
    } catch (err) {
      console.error("Error listing speakers:", err);
    }
  }

  async function initMedia() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { 
        echoCancellation: true, 
        noiseSuppression: true, 
        autoGainControl: true 
      }
    });
    localStreamRef.current = stream;
    stream.getTracks().forEach(track => pcRef.current.addTrack(track, stream));
    
    await refreshDevices();
  } catch (err) {
    console.error("Media Error:", err);
    
    // Specifically handling the overlay/permission error
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      alert("Permission Denied: Please close any floating bubbles (like Messenger) or screen overlays and try again.");
    } else if (err.name === 'NotFoundError') {
      alert("No microphone found on this device.");
    } else {
      alert("Could not access microphone. Please ensure no other app is using it.");
    }
    
    // Reset state so the user can try clicking 'Call' or 'Accept' again
    cleanupCall(); 
  }
}

  async function switchSpeaker(deviceId) {
    if (remoteAudioRef.current && remoteAudioRef.current.setSinkId) {
      try {
        await remoteAudioRef.current.setSinkId(deviceId);
        setSelectedOutput(deviceId);
        console.log(`Audio routed to: ${deviceId}`);
      } catch (err) {
        console.error("Failed to switch speaker:", err);
      }
    }
  }

  async function startCall() {
    if (!targetCode) return;
    targetCodeRef.current = targetCode;
    setStatus("Calling...");
    await initMedia();
    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);
    socket.emit("call-user", { to: targetCode, offer });
  }

  async function acceptCall() {
    targetCodeRef.current = incomingCall.from;
    setTargetCode(incomingCall.from);
    await initMedia();
    await pcRef.current.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
    const answer = await pcRef.current.createAnswer();
    await pcRef.current.setLocalDescription(answer);
    socket.emit("answer-call", { to: incomingCall.from, answer });
    setIncomingCall(null);
    setInCall(true);
  }

  function cleanupCall() {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    pcRef.current = createPeerConnection();
    pendingCandidatesRef.current = [];
    setInCall(false);
    setIncomingCall(null);
    setStatus("Idle");
  }

  return (
    <div className="app-container">
      <div className="glass-card">
        <div className={`status-pill ${status}`}>{status}</div>
        
        <header>
          <h1>EchoCall</h1>
          <p className="my-code">ID: <span>{myCode || "---"}</span></p>
        </header>

        <main>
          {!inCall && !incomingCall && (
            <div className="dialer">
              <input value={targetCode} onChange={e => setTargetCode(e.target.value)} placeholder="Friend's ID" />
              <button className="btn-primary" onClick={startCall}>Start Call</button>
            </div>
          )}

          {incomingCall && (
            <div className="call-alert">
              <p>Incoming Call...</p>
              <div className="btn-group">
                <button className="btn-success" onClick={acceptCall}>Accept</button>
                <button className="btn-danger" onClick={() => { socket.emit("call-rejected", { to: incomingCall.from }); setIncomingCall(null); }}>Reject</button>
              </div>
            </div>
          )}

          {inCall && (
            <div className="active-ui">
              <div className="timer">Connected</div>
              
              {/* Speaker Selector - only shows if browser supports it */}
              {canSwitchSpeaker && outputs.length > 0 && (
                <div className="speaker-box">
                  <label>Speaker Output</label>
                  <select value={selectedOutput} onChange={e => switchSpeaker(e.target.value)}>
                    <option value="default">Default Speaker</option>
                    {outputs.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Speaker ${d.deviceId.slice(0, 5)}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="controls">
                <button className={`btn-icon ${isMuted ? 'active' : ''}`} onClick={() => {
                  const track = localStreamRef.current.getAudioTracks()[0];
                  track.enabled = !track.enabled;
                  setIsMuted(!track.enabled);
                }}>{isMuted ? "🔇" : "🎤"}</button>
                
                <button className="btn-hangup" onClick={() => {
                   socket.emit("call-ended", { to: targetCodeRef.current });
                   cleanupCall();
                }}>✕</button>
              </div>
            </div>
          )}
        </main>
      </div>
      <audio ref={remoteAudioRef} autoPlay playsInline />
    </div>
  );
}
