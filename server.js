require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const OpenAI = require('openai');
const Anthropic = require('@anthropic-ai/sdk');
const { Resend } = require('resend');  // ← NEW
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST']
}));
app.use(express.json());
app.use(express.static('.'));

const upload = multer({ dest: 'uploads/' });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'your-openai-api-key-here'
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// ← NEW: Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

app.get('/', (req, res) => {
  res.json({ 
    message: 'TaskWhisper backend is running!',
    endpoints: {
      health: '/api/health',
      transcribe: '/api/transcribe (POST with audio file)',
      analyzeMemo: '/api/analyze-memo (POST with transcript)',
      sendEmail: '/api/send-email (POST with email data)'  // ← NEW
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date(),
    whisperAvailable: !!process.env.OPENAI_API_KEY,
    claudeAvailable: !!process.env.ANTHROPIC_API_KEY,
    emailAvailable: !!process.env.RESEND_API_KEY  // ← NEW
  });
});

app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  let renamedPath = null;
  
  try {
    console.log('📝 Transcription request received');
    
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    console.log('📁 File received:', req.file.originalname, `(${req.file.size} bytes)`);

    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your-openai-api-key-here') {
      console.warn('⚠️  No OpenAI API key configured, using mock transcription');
      
      const mockTranscript = "This is a test transcription. Configure your OpenAI API key to enable real Whisper transcription.";
      fs.unlinkSync(req.file.path);
      
      return res.json({ 
        success: true, 
        transcript: mockTranscript,
        mock: true
      });
    }

    console.log('🎤 Sending to Whisper API...');
    
    renamedPath = req.file.path + '.webm';
    fs.renameSync(req.file.path, renamedPath);
    
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(renamedPath),
      model: 'whisper-1',
      language: 'en',
    });

    console.log('✅ Transcription successful:', transcription.text);

    fs.unlinkSync(renamedPath);

    res.json({ 
      success: true, 
      transcript: transcription.text,
      mock: false
    });

  } catch (error) {
    console.error('❌ Transcription error:', error);
    
    if (renamedPath && fs.existsSync(renamedPath)) {
      fs.unlinkSync(renamedPath);
    } else if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      error: 'Transcription failed', 
      details: error.message 
    });
  }
});

app.post('/api/analyze-memo', async (req, res) => {
  try {
    const { transcript } = req.body;

    console.log('📝 Analyzing transcript with Claude:', transcript);

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'Anthropic API key not configured'
      });
    }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `You are an intelligent task analyzer. Analyze this voice memo transcript and extract actionable information.

Transcript: "${transcript}"

Extract and return a JSON object with:
1. tasks: Array of task objects, each with:
   - description: Clear task description
   - suggestedDate: Suggested date/time (or "Not specified")
   - priority: "urgent", "normal", or "low"
   - category: "work", "personal", "health", "shopping", "calls", or "other"
2. emailDraft: A personalized reminder email for the first/main task

Example format:
{
  "tasks": [
    {
      "description": "Call mom to check in",
      "suggestedDate": "Today evening",
      "priority": "normal",
      "category": "calls"
    }
  ],
  "emailDraft": "Hi! Just a friendly reminder to call your mom this evening. She'd love to hear from you!"
}

Respond ONLY with valid JSON, no other text.`
      }]
    });

    const responseText = message.content[0].text;
    console.log('🤖 Claude raw response:', responseText);

    let cleanedResponse = responseText.trim();
    cleanedResponse = cleanedResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    
    const analysis = JSON.parse(cleanedResponse);

    console.log('✅ Claude analysis parsed:', analysis);

    res.json({
      success: true,
      analysis: analysis
    });

  } catch (error) {
    console.error('❌ Error analyzing with Claude:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ← NEW ENDPOINT: Send email
app.post('/api/send-email', async (req, res) => {
  try {
    const { to, from, subject, emailBody, tasks } = req.body;

    console.log('📧 Sending email to:', to);

    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'Resend API key not configured'
      });
    }

    // Format tasks as HTML
    const tasksHtml = tasks.map(task => `
      <div style="background: #f9f9f9; border-left: 4px solid #667eea; padding: 15px; margin: 10px 0; border-radius: 5px;">
        <h3 style="margin: 0 0 10px 0; color: #333;">${task.description}</h3>
        <p style="margin: 5px 0; color: #666;">📅 <strong>When:</strong> ${task.suggestedDate}</p>
        <p style="margin: 5px 0; color: #666;">⚡ <strong>Priority:</strong> ${task.priority}</p>
        <p style="margin: 5px 0; color: #666;">📂 <strong>Category:</strong> ${task.category}</p>
      </div>
    `).join('');

    // Create HTML email
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">🎤 TaskWhisper Reminder</h1>
          </div>
          
          <div style="background: white; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
            <p style="font-size: 16px; color: #666; margin-bottom: 20px;">${emailBody}</p>
            
            <h2 style="color: #667eea; margin-top: 30px; margin-bottom: 20px;">Your Tasks:</h2>
            ${tasksHtml}
            
            <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; text-align: center; color: #999; font-size: 14px;">
              <p>Sent from TaskWhisper - Your AI-powered voice memo assistant</p>
            </div>
          </div>
        </body>
      </html>
    `;

    // Send email via Resend
    const data = await resend.emails.send({
      from: 'TaskWhisper <onboarding@resend.dev>',  // Resend's verified domain
      to: to,
      subject: subject || 'TaskWhisper Reminder',
      html: htmlContent,
    });

    console.log('✅ Email sent successfully:', data);

    res.json({
      success: true,
      emailId: data.id,
      message: 'Email sent successfully'
    });

  } catch (error) {
    console.error('❌ Error sending email:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 TaskWhisper Backend Started!`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📍 Server: http://localhost:${PORT}`);
  console.log(`🏥 Health: http://localhost:${PORT}/api/health`);
  console.log(`🎤 Whisper: ${process.env.OPENAI_API_KEY ? '✅ Enabled' : '⚠️  Not configured (using mock)'}`);
  console.log(`🧠 Claude: ${process.env.ANTHROPIC_API_KEY ? '✅ Enabled' : '⚠️  Not configured'}`);
  console.log(`📧 Email: ${process.env.RESEND_API_KEY ? '✅ Enabled' : '⚠️  Not configured'}`);  // ← NEW
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});