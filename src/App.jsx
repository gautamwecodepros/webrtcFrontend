import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";

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

  useEffect(() => {
    pcRef.current = new RTCPeerConnection({
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

    socket.on("your-code", setMyCode);

    pcRef.current.ontrack = async (e) => {
      remoteAudioRef.current.srcObject = e.streams[0];
      try {
        await remoteAudioRef.current.play();
      } catch {}
    };

    pcRef.current.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("ice-candidate", {
          to: targetCode,
          candidate: e.candidate,
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
      await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
    });

    socket.on("call-ended", endCall);
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
    await initMic();

    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);

    socket.emit("call-user", {
      to: targetCode,
      offer,
    });
  }

  async function acceptCall() {
    await initMic();

    await pcRef.current.setRemoteDescription(
      new RTCSessionDescription(incomingCall.offer),
    );

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

  function endCall() {
    pcRef.current.close();

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
    }

    setInCall(false);
    setIncomingCall(null);

    socket.emit("call-ended", { to: targetCode });
  }

  return (
    <div style={{ textAlign: "center", padding: 30 }}>
      <h2>Your Call Code</h2>
      <h1>{myCode}</h1>

      {!inCall && !incomingCall && (
        <>
          <input
            placeholder="Enter code"
            value={targetCode}
            onChange={(e) => setTargetCode(e.target.value)}
          />
          <br />
          <button onClick={startCall}>Call</button>
        </>
      )}

      {incomingCall && (
        <>
          <h3>Incoming call from {incomingCall.from}</h3>
          <button onClick={acceptCall}>Accept</button>
          <button onClick={() => setIncomingCall(null)}>Reject</button>
        </>
      )}

      {inCall && <button onClick={endCall}>Hang Up</button>}

      <audio ref={remoteAudioRef} autoPlay playsInline />
    </div>
  );
}
