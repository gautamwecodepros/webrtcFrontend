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
  const [connectionStatus, setConnectionStatus] = useState("Idle");
  const [audioOutput, setAudioOutput] = useState("default");
  const [availableOutputs, setAvailableOutputs] = useState([]);

  const pcRef = useRef(null);
  const remoteAudioRef = useRef();
  const localStreamRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const targetCodeRef = useRef("");

  // 1. Voice-optimized Constraints
  // These settings tell the browser: "This is a phone call, not music."
  const audioConstraints = {
    audio: {
      echoCancellation: true, // Crucial for clarity when using loudspeakers
      noiseSuppression: true, // Removes background hiss
      autoGainControl: true,  // Levels out volume differences
      channelCount: 1,        // Mono (cleaner for voice, less bandwidth)
      latency: 0,             // Lowest possible latency
    },
    video: false,
  };

  function createPeerConnection() {
    if (pcRef.current) pcRef.current.close();

    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = (e) => {
      if (e.candidate && targetCodeRef.current) {
        socket.emit("ice-candidate", {
          to: targetCodeRef.current,
          candidate: e.candidate,
        });
      }
    };

    pc.ontrack = (e) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = e.streams[0];
        // Attempt to play immediately
        remoteAudioRef.current.play().catch(console.error);
      }
    };

    pc.onconnectionstatechange = () => {
      setConnectionStatus(pc.connectionState);
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        cleanupCall();
      }
    };

    return pc;
  }

  useEffect(() => {
    pcRef.current = createPeerConnection();

    // Check for available audio output devices (Speakers/Earpieces)
    getAudioOutputs();

    socket.on("your-code", setMyCode);

    socket.on("incoming-call", ({ from, offer }) => {
      setIncomingCall({ from, offer });
    });

    socket.on("call-accepted", async ({ answer }) => {
      try {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        processPendingCandidates();
        setInCall(true);
      } catch (err) {
        console.error("Error setting remote desc:", err);
        cleanupCall();
      }
    });

    socket.on("ice-candidate", async (candidate) => {
      if (pcRef.current && pcRef.current.remoteDescription) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error("Error adding candidate:", e);
        }
      } else {
        pendingCandidatesRef.current.push(candidate);
      }
    });

    socket.on("call-ended", () => {
      alert("Call ended");
      cleanupCall();
    });

    socket.on("call-rejected", () => {
      alert("Call rejected");
      cleanupCall();
    });

    return () => {
      socket.off();
      if (pcRef.current) pcRef.current.close();
    };
  }, []);

  // Helper: Get available speakers/earpieces
  async function getAudioOutputs() {
    try {
      // Must ask permission first to see device labels
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter((d) => d.kind === "audiooutput");
      setAvailableOutputs(outputs);
    } catch (e) {
      console.error("Error enumerating devices:", e);
    }
  }

  // Helper: Change Audio Output (Toggle Speaker/Earpiece)
  async function handleAudioOutputChange(deviceId) {
    if (remoteAudioRef.current && "setSinkId" in remoteAudioRef.current) {
      try {
        await remoteAudioRef.current.setSinkId(deviceId);
        setAudioOutput(deviceId);
      } catch (error) {
        console.error("Error setting audio output:", error);
      }
    } else {
      console.warn("Audio Output selection not supported by this browser.");
    }
  }

  async function processPendingCandidates() {
    while (pendingCandidatesRef.current.length > 0) {
      const candidate = pendingCandidatesRef.current.shift();
      try {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error(e);
      }
    }
  }

  async function initMic() {
    if (localStreamRef.current) return;

    try {
      // Apply the heavy processing constraints here
      const stream = await navigator.mediaDevices.getUserMedia(audioConstraints);
      localStreamRef.current = stream;

      stream.getTracks().forEach((track) => {
        const senders = pcRef.current.getSenders();
        if (!senders.find((s) => s.track === track)) {
          pcRef.current.addTrack(track, stream);
        }
      });
    } catch (err) {
      console.error("Mic Error:", err);
      alert("Microphone access denied or error.");
    }
  }

  async function startCall() {
    if (!targetCode) return;
    targetCodeRef.current = targetCode;
    setConnectionStatus("Calling...");
    await initMic();

    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);

    socket.emit("call-user", { to: targetCode, offer });
  }

  async function acceptCall() {
    targetCodeRef.current = incomingCall.from;
    setTargetCode(incomingCall.from);
    setConnectionStatus("Connecting...");
    await initMic();

    await pcRef.current.setRemoteDescription(
      new RTCSessionDescription(incomingCall.offer)
    );
    processPendingCandidates();

    const answer = await pcRef.current.createAnswer();
    await pcRef.current.setLocalDescription(answer);

    socket.emit("answer-call", { to: targetCodeRef.current, answer });
    setIncomingCall(null);
    setInCall(true);
  }

  function cleanupCall() {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) pcRef.current.close();
    pcRef.current = createPeerConnection();
    pendingCandidatesRef.current = [];
    setInCall(false);
    setIncomingCall(null);
    setConnectionStatus("Idle");
  }

  return (
    <div className="app">
      <h2>Voice Call</h2>
      <div className="status">Status: {connectionStatus}</div>

      <div className="code-box">
        <p>My Code: <b>{myCode}</b></p>
        <button onClick={() => navigator.clipboard.writeText(myCode)}>Copy</button>
      </div>

      {!inCall && !incomingCall && (
        <div className="dialer">
          <input
            value={targetCode}
            onChange={(e) => setTargetCode(e.target.value)}
            placeholder="Enter friend's code"
          />
          <button onClick={startCall}>Call</button>
        </div>
      )}

      {incomingCall && (
        <div className="incoming">
          <p>Call from {incomingCall.from}</p>
          <button onClick={acceptCall}>Accept</button>
          <button onClick={() => socket.emit("call-rejected", { to: incomingCall.from })}>
            Reject
          </button>
        </div>
      )}

      {inCall && (
        <div className="active-call">
          <button onClick={() => socket.emit("call-ended", { to: targetCodeRef.current })}>
            Hang Up
          </button>
          
          {/* Audio Output Switcher (Visible only if browser supports it) */}
          {availableOutputs.length > 0 && (
            <div className="audio-switcher">
              <label>Output: </label>
              <select 
                onChange={(e) => handleAudioOutputChange(e.target.value)}
                value={audioOutput}
              >
                {availableOutputs.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Speaker ${device.deviceId.slice(0, 5)}...`}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Audio Element */}
      <audio ref={remoteAudioRef} autoPlay playsInline controls={false} />
    </div>
  );
}
