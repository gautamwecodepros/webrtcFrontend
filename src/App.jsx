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
  const [outputs, setOutputs] = useState([]);
  const [isMuted, setIsMuted] = useState(false);

  const pcRef = useRef(null);
  const remoteAudioRef = useRef();
  const localStreamRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const targetCodeRef = useRef("");

  // Professional Voice Constraints
  const mediaConstraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000,
    }
  };

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
    socket.on("your-code", setMyCode);
    socket.on("incoming-call", ({ from, offer }) => setIncomingCall({ from, offer }));
    socket.on("call-rejected", () => { alert("Call Rejected"); cleanupCall(); });
    socket.on("call-ended", cleanupCall);

    socket.on("call-accepted", async ({ answer }) => {
      try {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        while (pendingCandidatesRef.current.length > 0) {
          await pcRef.current.addIceCandidate(pendingCandidatesRef.current.shift());
        }
        setInCall(true);
      } catch (e) { console.error(e); }
    });

    socket.on("ice-candidate", async (candidate) => {
      if (pcRef.current?.remoteDescription) {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
      } else {
        pendingCandidatesRef.current.push(candidate);
      }
    });

    return () => { socket.off(); pcRef.current?.close(); };
  }, []);

  async function initMedia() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      localStreamRef.current = stream;
      stream.getTracks().forEach(track => pcRef.current.addTrack(track, stream));
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      setOutputs(devices.filter(d => d.kind === "audiooutput"));
    } catch (err) {
      alert("Microphone access is required for calls.");
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

  function endCall() {
    socket.emit("call-ended", { to: targetCodeRef.current });
    cleanupCall();
  }

  const toggleMute = () => {
    if (localStreamRef.current) {
      const enabled = localStreamRef.current.getAudioTracks()[0].enabled;
      localStreamRef.current.getAudioTracks()[0].enabled = !enabled;
      setIsMuted(enabled);
    }
  };

  async function switchSpeaker(id) {
    if (remoteAudioRef.current.setSinkId) {
      await remoteAudioRef.current.setSinkId(id);
    }
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
              <p>Incoming from <b>{incomingCall.from.slice(0, 6)}</b></p>
              <div className="btn-group">
                <button className="btn-success" onClick={acceptCall}>Accept</button>
                <button className="btn-danger" onClick={() => { socket.emit("call-rejected", { to: incomingCall.from }); setIncomingCall(null); }}>Reject</button>
              </div>
            </div>
          )}

          {inCall && (
            <div className="active-ui">
              <div className="timer">In Conversation</div>
              <div className="controls">
                <button className={`btn-icon ${isMuted ? 'active' : ''}`} onClick={toggleMute}>{isMuted ? "🔇" : "🎤"}</button>
                <button className="btn-hangup" onClick={endCall}>✕</button>
              </div>
              {outputs.length > 0 && (
                <select className="speaker-select" onChange={e => switchSpeaker(e.target.value)}>
                  {outputs.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || "Speaker"}</option>)}
                </select>
              )}
            </div>
          )}
        </main>
      </div>
      <audio ref={remoteAudioRef} autoPlay playsInline />
    </div>
  );
}
