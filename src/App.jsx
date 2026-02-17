import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import "./App.css";

// Initialize socket outside component to prevent multiple connections
const socket = io("https://webrtcbackend-production-0dc3.up.railway.app", {
  transports: ["websocket", "polling"],
});

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    // Only use TURN servers if you have valid, paid credentials. 
    // Broken TURN servers cause connection failures.
  ],
};

export default function App() {
  const [myCode, setMyCode] = useState("");
  const [targetCode, setTargetCode] = useState("");
  const [incomingCall, setIncomingCall] = useState(null);
  const [inCall, setInCall] = useState(false);
  
  // Ref to track connection state for debugging
  const [connectionStatus, setConnectionStatus] = useState("Idle");

  const pcRef = useRef(null);
  const remoteAudioRef = useRef();
  const localStreamRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const targetCodeRef = useRef("");

  function createPeerConnection() {
    // Close existing if any
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
        // Explicitly attempt to play audio to bypass autoplay policies
        remoteAudioRef.current.play().catch(e => console.error("Audio play error:", e));
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("Connection State:", pc.connectionState);
      setConnectionStatus(pc.connectionState);
      
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        cleanupCall();
      }
    };

    return pc;
  }

  // Handle Socket Events
  useEffect(() => {
    // Initialize PC on mount
    pcRef.current = createPeerConnection();

    // Setup Socket Listeners
    socket.on("connect", () => console.log("Socket Connected"));
    socket.on("your-code", (code) => setMyCode(code));

    socket.on("incoming-call", ({ from, offer }) => {
      console.log("Incoming Call from:", from);
      setIncomingCall({ from, offer });
    });

    socket.on("call-accepted", async ({ answer }) => {
      console.log("Call Accepted, setting remote description...");
      try {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        
        // Process any queued candidates now that remote description is set
        processPendingCandidates();
        setInCall(true);
      } catch (err) {
        console.error("Error setting remote description:", err);
        cleanupCall();
      }
    });

    socket.on("ice-candidate", async (candidate) => {
      if (pcRef.current && pcRef.current.remoteDescription) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error("Error adding received candidate:", e);
        }
      } else {
        // Queue candidates if remote description isn't ready yet
        pendingCandidatesRef.current.push(candidate);
      }
    });

    socket.on("call-ended", () => {
      alert("Call ended by partner");
      cleanupCall();
    });

    socket.on("call-rejected", () => {
      alert("Call was rejected");
      cleanupCall();
    });

    // Cleanup on Unmount
    return () => {
      socket.off("your-code");
      socket.off("incoming-call");
      socket.off("call-accepted");
      socket.off("ice-candidate");
      socket.off("call-ended");
      socket.off("call-rejected");
      if (pcRef.current) pcRef.current.close();
    };
  }, []);

  async function processPendingCandidates() {
    if (!pcRef.current) return;
    while (pendingCandidatesRef.current.length > 0) {
      const candidate = pendingCandidatesRef.current.shift();
      try {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error("Error adding pending candidate:", e);
      }
    }
  }

  async function initMic() {
    // If we already have a stream, don't get it again
    if (localStreamRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

      // Add tracks to the Peer Connection
      stream.getTracks().forEach((track) => {
        // Check if track is already added to avoid "sender already exists" error
        const senders = pcRef.current.getSenders();
        const trackAlreadyAdded = senders.some(sender => sender.track === track);
        if (!trackAlreadyAdded) {
            pcRef.current.addTrack(track, stream);
        }
      });
    } catch (err) {
      console.error("Mic error:", err);
      alert("Could not access microphone. Please check permissions.");
    }
  }

  async function startCall() {
    if (!targetCode) return alert("Please enter a code");
    
    targetCodeRef.current = targetCode;
    setConnectionStatus("Calling...");

    await initMic();

    try {
      const offer = await pcRef.current.createOffer();
      await pcRef.current.setLocalDescription(offer);

      socket.emit("call-user", {
        to: targetCode,
        offer,
      });
    } catch (err) {
      console.error("Error starting call:", err);
    }
  }

  async function acceptCall() {
    const callerId = incomingCall.from;
    targetCodeRef.current = callerId;
    setTargetCode(callerId);
    setConnectionStatus("Connecting...");

    await initMic();

    try {
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      
      // Process candidates that arrived before we clicked accept
      processPendingCandidates();

      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);

      socket.emit("answer-call", {
        to: callerId,
        answer,
      });

      setIncomingCall(null);
      setInCall(true);
    } catch (err) {
      console.error("Error accepting call:", err);
      cleanupCall();
    }
  }

  function rejectCall() {
    socket.emit("call-rejected", { to: incomingCall.from });
    setIncomingCall(null);
  }

  function endCall() {
    socket.emit("call-ended", { to: targetCodeRef.current });
    cleanupCall();
  }

  function cleanupCall() {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onicecandidate = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
    }

    // Create a fresh PC for the next call
    pcRef.current = createPeerConnection();
    pendingCandidatesRef.current = [];
    
    setInCall(false);
    setIncomingCall(null);
    setTargetCode("");
    setConnectionStatus("Idle");
  }

  return (
    <div className="app">
      <h2>WebRTC Audio Call</h2>
      <div className="status-badge">Status: {connectionStatus}</div>

      <div className="code-box">
        <p>Your Code:</p>
        <div className="code-display">
            {myCode || "Connecting to server..."}
        </div>
        <button onClick={() => navigator.clipboard.writeText(myCode)}>
          Copy Code
        </button>
      </div>

      <div className="controls">
        {!inCall && !incomingCall && (
          <div className="dialer">
            <input
              placeholder="Enter friend's code"
              value={targetCode}
              onChange={(e) => setTargetCode(e.target.value)}
            />
            <button className="btn-call" onClick={startCall}>Call</button>
          </div>
        )}

        {incomingCall && (
          <div className="incoming-alert">
            <p>Incoming Call from {incomingCall.from.slice(0, 5)}...</p>
            <div className="action-buttons">
                <button className="btn-accept" onClick={acceptCall}>Accept</button>
                <button className="btn-reject" onClick={rejectCall}>Reject</button>
            </div>
          </div>
        )}

        {inCall && (
            <div className="active-call">
                <p>In Call with {targetCodeRef.current.slice(0, 5)}...</p>
                <button className="btn-end" onClick={endCall}>Hang Up</button>
            </div>
        )}
      </div>

      {/* PlaysInline ensures audio works on mobile browsers */}
      <audio ref={remoteAudioRef} autoPlay playsInline controls={false} />
    </div>
  );
}
