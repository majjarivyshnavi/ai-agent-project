import React, { useState } from "react";
import config from "./config";

async function getAIResponse(message: string) {
  const response = await fetch(config.AI_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: message,
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  return await response.json();
}

function Chatbot() {
  const [input, setInput] = useState<string>("");
  const [output, setOutput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  const handleClick = async () => {
    if (!input.trim()) {
      setOutput("⚠️ Please enter a message");
      return;
    }

    try {
      setLoading(true);
      setOutput("Typing... ⏳");

      const res = await getAIResponse(input);
      setOutput(res.reply || "No response received");
      setInput("");
    } catch (error) {
      console.error("Error:", error);
      setOutput("❌ Error connecting to AI");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: "40px", borderTop: "1px solid #ccc", paddingTop: "20px" }}>
      <h3>AI Assistant 🤖</h3>

      <input
        type="text"
        placeholder="Enter your message"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        style={{ width: "300px", padding: "10px" }}
      />

      <br /><br />

      <button onClick={handleClick} disabled={loading}>
        {loading ? "Loading..." : "Ask AI"}
      </button>

      <p><b>Response:</b> {output || "No response yet..."}</p>
    </div>
  );
}

export default Chatbot;
