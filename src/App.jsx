import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";

const socket = io("https://webrtcbackend-production-0dc3.up.railway.app", {
  transports: ["websocket", "polling"],
});

export default function App() {
  const [myId, setMyId] = useState("");
  const [targetId, setTargetId] = useState("");

  const pcRef = useRef(null);
  const remoteAudioRef = useRef();

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
      console.log("Connected:", socket.id);
      setMyId(socket.id);
    });

    socket.on("connect_error", (err) => {
      console.error("Socket connect error:", err);
    });

    pcRef.current.ontrack = (event) => {
      remoteAudioRef.current.srcObject = event.streams[0];
    };

    pcRef.current.oniceconnectionstatechange = () => {
      console.log("ICE State:", pcRef.current.iceConnectionState);
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

      await pcRef.current.setRemoteDescription(
        new RTCSessionDescription(offer),
      );

      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);

      socket.emit("answer-call", {
        to: from,
        answer,
      });
    });

    socket.on("call-accepted", async ({ answer }) => {
      await pcRef.current.setRemoteDescription(
        new RTCSessionDescription(answer),
      );
    });

    socket.on("ice-candidate", async (candidate) => {
      try {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error("ICE error:", err);
      }
    });

    initMic();
  }, []);

  async function initMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      stream.getTracks().forEach((track) => {
        pcRef.current.addTrack(track, stream);
      });
    } catch (err) {
      console.error("Mic error:", err);
      alert("Microphone not found or permission denied");
    }
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
