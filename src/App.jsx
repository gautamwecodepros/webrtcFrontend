import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import "./App.css";

const socket = io("https://webrtcbackend-production-0dc3.up.railway.app", {
  transports: ["websocket", "polling"],
});

export default function App() {
  const [myId, setMyId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [incomingCall, setIncomingCall] = useState(null);
  const [inCall, setInCall] = useState(false);
  const [micReady, setMicReady] = useState(false);

  const pcRef = useRef(null);
  const remoteAudioRef = useRef();
  const localStreamRef = useRef();

  useEffect(() => {
    pcRef.current = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
        {
          urls: "turn:openrelay.metered.ca:443",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
      ],
    });

    socket.on("connect", () => {
      setMyId(socket.id);
    });

    pcRef.current.ontrack = (event) => {
      remoteAudioRef.current.srcObject = event.streams[0];
    };

    pcRef.current.onicecandidate = (event) => {
      if (event.candidate && targetId) {
        socket.emit("ice-candidate", {
          to: targetId,
          candidate: event.candidate,
        });
      }
    };

    socket.on("incoming-call", ({ from, offer }) => {
      setIncomingCall({ from, offer });
    });

    socket.on("call-accepted", async ({ answer }) => {
      await pcRef.current.setRemoteDescription(
        new RTCSessionDescription(answer),
      );
      setInCall(true);
    });

    socket.on("ice-candidate", async (candidate) => {
      try {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {}
    });

    socket.on("call-ended", endCall);
  }, []);

  async function initMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;

      stream.getTracks().forEach((track) => {
        pcRef.current.addTrack(track, stream);
      });

      setMicReady(true);
    } catch {
      alert("Mic permission required");
    }
  }

  async function startCall() {
    if (!micReady) await initMic();

    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);

    socket.emit("call-user", {
      to: targetId,
      offer,
    });
  }

  async function acceptCall() {
    if (!micReady) await initMic();

    await pcRef.current.setRemoteDescription(
      new RTCSessionDescription(incomingCall.offer),
    );

    const answer = await pcRef.current.createAnswer();
    await pcRef.current.setLocalDescription(answer);

    socket.emit("answer-call", {
      to: incomingCall.from,
      answer,
    });

    setTargetId(incomingCall.from);
    setIncomingCall(null);
    setInCall(true);
  }

  function endCall() {
    pcRef.current.close();

    pcRef.current = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
    }

    setInCall(false);
    setIncomingCall(null);
    setMicReady(false);

    socket.emit("call-ended", { to: targetId });
  }

  return (
    <div className="app-container">
      <div className="card">
        <div className="title">Your ID</div>
        <div className="user-id">{myId}</div>

        {!inCall && !incomingCall && (
          <>
            <input
              placeholder="Enter ID to call"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            />
            <button className="call-btn" onClick={startCall}>
              Call
            </button>
          </>
        )}

        {incomingCall && (
          <>
            <div className="calling">Incoming Call</div>
            <button className="accept-btn" onClick={acceptCall}>
              Accept
            </button>
            <button
              className="reject-btn"
              onClick={() => setIncomingCall(null)}
            >
              Reject
            </button>
          </>
        )}

        {inCall && (
          <>
            <div className="calling">In Call...</div>
            <button className="hangup-btn" onClick={endCall}>
              Hang Up
            </button>
          </>
        )}

        <audio ref={remoteAudioRef} autoPlay />
      </div>
    </div>
  );
}
