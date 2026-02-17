import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import "./App.css";

const socket = io("https://webrtcbackend-production-0dc3.up.railway.app", {
  transports: ["websocket", "polling"],
});

export default function App() {
  const [myCode, setMyCode] = useState("");
  const [targetCode, setTargetCode] = useState("");
  const [incomingCall, setIncomingCall] = useState(null);
  const [inCall, setInCall] = useState(false);

  const pcRef = useRef(null);
  const remoteAudioRef = useRef();
  const localStreamRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const peerRef = useRef("");

  function createPeerConnection() {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        {
          urls: [
            "turn:openrelay.metered.ca:80",
            "turn:openrelay.metered.ca:443?transport=tcp",
          ],
          username: "openrelayproject",
          credential: "openrelayproject",
        },
      ],
    });

    pc.ontrack = (e) => {
      remoteAudioRef.current.srcObject = e.streams[0];
      remoteAudioRef.current.play().catch(() => {});
    };

    pc.onicecandidate = (e) => {
      if (e.candidate && peerRef.current) {
        socket.emit("ice-candidate", {
          to: peerRef.current,
          candidate: e.candidate,
        });
      }
    };

    return pc;
  }

  useEffect(() => {
    pcRef.current = createPeerConnection();

    socket.on("your-code", setMyCode);

    socket.on("incoming-call", ({ from, offer }) => {
      peerRef.current = from;
      setIncomingCall({ from, offer });
    });

    socket.on("call-accepted", async ({ answer }) => {
      await pcRef.current.setRemoteDescription(
        new RTCSessionDescription(answer),
      );

      for (const candidate of pendingCandidatesRef.current) {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      }
      pendingCandidatesRef.current = [];

      setInCall(true);
    });

    socket.on("ice-candidate", async (candidate) => {
      if (pcRef.current.remoteDescription) {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        pendingCandidatesRef.current.push(candidate);
      }
    });

    socket.on("call-ended", cleanupCall);

    socket.on("call-rejected", () => {
      alert("Call rejected");
      cleanupCall();
    });

    return () => {
      socket.off("your-code");
      socket.off("incoming-call");
      socket.off("call-accepted");
      socket.off("ice-candidate");
      socket.off("call-ended");
      socket.off("call-rejected");
    };
  }, []);

  async function initMic() {
    if (localStreamRef.current) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStreamRef.current = stream;

    stream.getTracks().forEach((track) => {
      pcRef.current.addTrack(track, stream);
    });
  }

  async function startCall() {
    peerRef.current = targetCode;

    await initMic();

    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);

    socket.emit("call-user", {
      to: targetCode,
      offer,
    });
  }

  async function acceptCall() {
    peerRef.current = incomingCall.from;

    await initMic();

    await pcRef.current.setRemoteDescription(
      new RTCSessionDescription(incomingCall.offer),
    );

    for (const candidate of pendingCandidatesRef.current) {
      await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
    }
    pendingCandidatesRef.current = [];

    const answer = await pcRef.current.createAnswer();
    await pcRef.current.setLocalDescription(answer);

    socket.emit("answer-call", {
      to: incomingCall.from,
      answer,
    });

    setTargetCode(incomingCall.from);
    setIncomingCall(null);
    setInCall(true);
  }

  function rejectCall() {
    socket.emit("call-rejected", { to: incomingCall.from });
    cleanupCall();
  }

  function endCall() {
    socket.emit("call-ended", { to: peerRef.current });
    cleanupCall();
  }

  function cleanupCall() {
    if (pcRef.current) {
      pcRef.current.close();
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }

    pcRef.current = createPeerConnection();
    pendingCandidatesRef.current = [];

    setInCall(false);
    setIncomingCall(null);
  }

  return (
    <div className="app">
      <h2>Your Call Code</h2>

      <div className="code-box">
        {myCode}
        <button onClick={() => navigator.clipboard.writeText(myCode)}>
          Copy
        </button>
      </div>

      {!inCall && !incomingCall && (
        <>
          <input
            placeholder="Enter code"
            value={targetCode}
            onChange={(e) => setTargetCode(e.target.value)}
          />
          <button onClick={startCall}>Call</button>
        </>
      )}

      {incomingCall && (
        <>
          <p>Incoming Call from {incomingCall.from}</p>
          <button onClick={acceptCall}>Accept</button>
          <button onClick={rejectCall}>Reject</button>
        </>
      )}

      {inCall && <button onClick={endCall}>Hang Up</button>}

      <audio ref={remoteAudioRef} autoPlay playsInline />
    </div>
  );
}
