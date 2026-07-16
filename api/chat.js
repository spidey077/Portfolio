export const config = {
  runtime: 'edge',
};

// --- CACHE & CONFIG ---
let cachedFacts = "";
let lastFetchTime = 0;
const CACHE_DURATION = 300000; // 5 minutes in milliseconds
const GOOGLE_SHEET_CSV_URL = process.env.GOOGLE_SHEET_CSV_URL;

// Simple CSV parser for "Key, Value" or "Fact" rows
function parseCSV(csvText) {
  const lines = csvText.split('\n');
  return lines
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('Key,Value')) // Skip header if exists
    .map(line => {
      // Basic CSV split - handles simple rows. 
      // If client uses commas inside text, they should use "quotes"
      return `- ${line.replace(/,/g, ': ')}`; 
    })
    .join('\n');
}

async function getDynamicFacts() {
  if (!GOOGLE_SHEET_CSV_URL) return "";

  const now = Date.now();
  if (cachedFacts && (now - lastFetchTime < CACHE_DURATION)) {
    console.log("Using cached facts");
    return cachedFacts;
  }

  try {
    console.log("Fetching fresh facts from Google Sheets...");
    const response = await fetch(GOOGLE_SHEET_CSV_URL);
    if (!response.ok) throw new Error("Failed to fetch sheet");
    
    const csvText = await response.text();
    cachedFacts = parseCSV(csvText);
    lastFetchTime = now;
    return cachedFacts;
  } catch (error) {
    console.error("Error fetching dynamic facts:", error);
    return cachedFacts || ""; // Fallback to cache if available
  }
}

// In-memory rate limiting map
const ipRateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 5;

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  // Basic Rate Limiting
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const now = Date.now();

  if (ip !== 'unknown') {
    const userLimit = ipRateLimitMap.get(ip) || { count: 0, startTime: now };
    if (now - userLimit.startTime > RATE_LIMIT_WINDOW_MS) {
      userLimit.count = 0;
      userLimit.startTime = now;
    }
    userLimit.count++;
    if (userLimit.count > MAX_REQUESTS_PER_WINDOW) {
      return new Response(JSON.stringify({ error: 'Too many requests. Please try again later.' }), { status: 429 });
    }
    ipRateLimitMap.set(ip, userLimit);
  }

  try {
    const { messages } = await req.json();

    // 1. Fetch Dynamic Facts from Google Sheets
    const dynamicFacts = await getDynamicFacts();

    // 2. LEAD CAPTURE LOGIC (Email via Web3Forms)
    const WEB3FORMS_ACCESS_KEY = "4a99e2e7-0601-47b9-808f-111159741b4f";
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'user') {
        const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/;
        const match = lastMessage.content.match(emailRegex);
        if (match) {
          const email = match[0];
          const context = messages.slice(-5).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
          console.log("🚨 LEAD CAPTURED:", email);
          console.log("Chat context:", context);
          
          const formData = new FormData();
          formData.append("access_key", WEB3FORMS_ACCESS_KEY);
          formData.append("email", email);
          formData.append("message", `🚨 NEW LEAD FROM CHATBOT 🚨\n\nContext:\n${context}`);
          formData.append("source", "Chatbot");
          
          fetch("https://api.web3forms.com/submit", {
            method: 'POST',
            body: formData
          }).then(res => {
            console.log("Lead sent to Web3Forms successfully:", res.status);
          }).catch(e => {
            console.error("Lead Error:", e);
          });
        }
      }
    }

    const systemInstruction = `
You are a helpful chatbot for Imdadullah's portfolio website.

CORE INFO:
- Name: Imdadullah Chishti
- Role: Frontend Developer (2+ years experience)
- Technologies: HTML, CSS, JavaScript, React, Next.js, Tailwind CSS, GSAP
- Specializes in: Business websites, landing pages, custom chatbots
- Contact: WhatsApp +92 3318962777, Email: imdadullahchishti@gmail.com

LATEST UPDATES & FAQS (From Live Sheet):
${dynamicFacts || "No additional updates at the moment."}

RULES:
- Answer questions about Imdadullah, his skills, services, and work based on the CORE INFO above
- Be helpful, friendly, and concise (max 2-3 sentences)
- For "who are you": Say "I'm a chatbot for Imdadullah's portfolio website"
- For "who is imdadullah": Say "Imdadullah is a full stack developer with 3+ years of experience specializing in business websites,full stack applications, and custom chatbots"
- For "what services do you offer": List the services mentioned in CORE INFO
- For "how can i hire you": Say "To hire Imdadullah, drop your email address here and he will contact you. You can also reach via WhatsApp +92 3318962777"
- For unrelated questions (math, weather, etc.): Politely say "I can only help with questions about Imdadullah's work and services"
- If someone wants to hire or discuss a project: Ask them to drop their email
`;

    const openAIMessages = [
      { role: "system", content: systemInstruction },
      ...messages
    ];

    console.log("API Key present:", !!process.env.OPENAI_API_KEY);
    console.log("API Key length:", process.env.OPENAI_API_KEY?.length);
    console.log("Sending request to Groq API with messages:", JSON.stringify(openAIMessages).substring(0, 500));
    
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: openAIMessages,
        temperature: 0.7,
        max_tokens: 500
      })
    });

    console.log("Groq API response status:", response.status);
    const responseText = await response.text();
    console.log("Groq API raw response:", responseText.substring(0, 1000));
    
    if (!response.ok) {
      console.error("Groq API error:", responseText);
      return new Response(JSON.stringify({ error: "AI API failed", details: responseText }), { status: response.status });
    }

    const data = JSON.parse(responseText);
    console.log("Groq API parsed data:", JSON.stringify(data).substring(0, 500));
    const aiResponse = data.choices?.[0]?.message?.content || "";
    console.log("Extracted AI response:", aiResponse.substring(0, 200));
    console.log("AI response length:", aiResponse.length);
    
    return new Response(JSON.stringify({ content: aiResponse }), {
      headers: {
        'Content-Type': 'application/json',
      },
    });

  } catch (error) {
    console.error("Chat API error:", error);
    return new Response(JSON.stringify({ error: "Something went wrong" }), { status: 500 });
  }
}
