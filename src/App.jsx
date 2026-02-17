import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";

const socket = io("http://webrtcbackend-production-0dc3.up.railway.app");

function App() {
  const [myId, setMyId] = useState("");
  const [targetId, setTargetId] = useState("");

  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef();

  useEffect(() => {
    pcRef.current = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        {
          urls: "turn:relay.metered.ca:80",
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
      if (event.candidate) {
        socket.emit("ice-candidate", {
          to: targetId,
          candidate: event.candidate,
        });
      }
    };

    socket.on("incoming-call", async ({ from, offer }) => {
      setTargetId(from);

      await pcRef.current.setRemoteDescription(offer);

      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);

      socket.emit("answer-call", {
        to: from,
        answer,
      });
    });

    socket.on("call-accepted", async ({ answer }) => {
      await pcRef.current.setRemoteDescription(answer);
    });

    socket.on("ice-candidate", async (candidate) => {
      await pcRef.current.addIceCandidate(candidate);
    });

    initMic();
  }, []);

  async function initMic() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStreamRef.current = stream;

    stream.getTracks().forEach((track) => {
      pcRef.current.addTrack(track, stream);
    });
  }

  async function callUser() {
    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);

    socket.emit("call-user", {
      to: targetId,
      offer,
    });
  }

  return (
    <div>
      <h2>Your ID: {myId}</h2>

      <input
        placeholder="Enter ID to call"
        value={targetId}
        onChange={(e) => setTargetId(e.target.value)}
      />

      <button onClick={callUser}>Call</button>

      <audio ref={remoteAudioRef} autoPlay />
    </div>
  );
}

export default App;
