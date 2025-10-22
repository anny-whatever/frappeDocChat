// Test script to verify SSE streaming works with proper client
const http = require("http");

async function testStreaming() {
  console.log("🧪 Testing SSE streaming with proper client...");

  const postData = JSON.stringify({
    message: "What is a DocType?",
    conversationHistory: [],
  });

  const options = {
    hostname: "localhost",
    port: 3001,
    path: "/api/chat/stream",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "Content-Length": Buffer.byteLength(postData),
    },
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      console.log(`✅ Connected to stream (Status: ${res.statusCode})`);

      let buffer = "";
      let eventCount = 0;
      let deltaCount = 0;
      let lastContent = "";
      let startTime = Date.now();

      res.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            const event = line.slice(7);
            eventCount++;
            console.log(`📡 Event ${eventCount}: ${event}`);
          } else if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.content) {
                deltaCount++;
                lastContent += data.content;
                console.log(`📝 Delta ${deltaCount}: "${data.content}"`);
              } else {
                console.log(`📊 Data:`, data);
              }
            } catch (e) {
              console.log(`📄 Raw data: ${line.slice(6)}`);
            }
          }
        }

        // Stop after receiving some deltas or after 30 seconds
        if (deltaCount >= 10 || Date.now() - startTime > 30000) {
          console.log("✅ Received enough data, stopping test");
          req.destroy();
          resolve();
        }
      });

      res.on("end", () => {
        console.log("🏁 Stream ended");
        console.log(`\n📈 Test Results:`);
        console.log(`- Total events: ${eventCount}`);
        console.log(`- Delta events: ${deltaCount}`);
        console.log(`- Final content length: ${lastContent.length}`);
        console.log(`- Sample content: "${lastContent.slice(0, 100)}..."`);
        resolve();
      });

      res.on("error", (error) => {
        console.error("❌ Response error:", error.message);
        reject(error);
      });
    });

    req.on("error", (error) => {
      console.error("❌ Request error:", error.message);
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

// Run test with timeout
const timeout = setTimeout(() => {
  console.log("⏰ Test timeout after 45 seconds");
  process.exit(0);
}, 45000);

testStreaming()
  .then(() => {
    clearTimeout(timeout);
    console.log("✅ Test completed");
    process.exit(0);
  })
  .catch((error) => {
    clearTimeout(timeout);
    console.error("❌ Test error:", error);
    process.exit(1);
  });