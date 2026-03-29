# Sipho Realtime Voice Server

Real-time AI voice call server using Twilio Media Streams + OpenAI Realtime API.

## Deploy to Railway

1. Go to https://railway.app
2. Click "New Project" → "Deploy from GitHub repo" OR "Deploy from template"
3. Upload these files or connect GitHub
4. Set environment variable: OPENAI_API_KEY=your_key
5. Railway will give you a URL like https://sipho-xxx.railway.app

## After deploying

Point your Twilio number's webhook to:
https://your-railway-url.railway.app/incoming-call

## Environment Variables
- OPENAI_API_KEY: Your OpenAI API key
