import Fastify from 'fastify';
import WebSocket from 'ws';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = process.env.PORT || 5050;

const SYSTEM_MESSAGE = `You are Sipho Dlamini, a sharp and warm M&A specialist from Ronen Enterprises, a well-funded private investment group in Johannesburg. You are calling to potentially acquire the person's business. Be confident, warm and professional with a South African tone. Explore one topic at a time: What does the business do? How long has it been operating? Annual revenues and profits? Staff count? Main assets? Recurring revenue? Why consider selling? Calculate valuation at 3-5x EBITDA and make a ballpark offer. Keep responses SHORT — 2-3 sentences max. One question at a time.`;

const VOICE = 'shimmer'; // OpenAI Realtime voice
const TEMPERATURE = 0.8;

const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

const LOG_EVENT_TYPES = [
    'error', 'response.content.done', 'rate_limits.updated',
    'response.done', 'input_audio_buffer.committed',
    'input_audio_buffer.speech_stopped', 'input_audio_buffer.speech_started',
    'session.created', 'session.updated'
];

fastify.get('/', async (request, reply) => {
    reply.send({ message: 'Sipho Realtime Voice Server is running!' });
});

fastify.all('/incoming-call', async (request, reply) => {
    const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="wss://${request.headers.host}/media-stream" />
    </Connect>
</Response>`;
    reply.type('text/xml').send(twimlResponse);
});

fastify.register(async (fastify) => {
    fastify.get('/media-stream', { websocket: true }, (connection, req) => {
        console.log('Call connected');

        let streamSid = null;
        let latestMediaTimestamp = 0;
        let lastAssistantItem = null;
        let markQueue = [];
        let responseStartTimestampTwilio = null;

        const openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                'OpenAI-Beta': 'realtime=v1'
            }
        });

        const initializeSession = () => {
            const sessionUpdate = {
                type: 'session.update',
                session: {
                    turn_detection: { type: 'server_vad' },
                    input_audio_format: 'g711_ulaw',
                    output_audio_format: 'g711_ulaw',
                    voice: VOICE,
                    instructions: SYSTEM_MESSAGE,
                    modalities: ['text', 'audio'],
                    temperature: TEMPERATURE,
                }
            };
            openAiWs.send(JSON.stringify(sessionUpdate));

            // Sipho speaks first
            setTimeout(() => {
                const greeting = {
                    type: 'conversation.item.create',
                    item: {
                        type: 'message',
                        role: 'user',
                        content: [{ type: 'input_text', text: 'Start the call by greeting the person and introducing yourself as Sipho Dlamini from Ronen Enterprises.' }]
                    }
                };
                openAiWs.send(JSON.stringify(greeting));
                openAiWs.send(JSON.stringify({ type: 'response.create' }));
            }, 500);
        };

        const handleSpeechStartedEvent = () => {
            if (markQueue.length > 0 && responseStartTimestampTwilio != null) {
                const elapsedTime = latestMediaTimestamp - responseStartTimestampTwilio;
                if (lastAssistantItem) {
                    openAiWs.send(JSON.stringify({
                        type: 'conversation.item.truncate',
                        item_id: lastAssistantItem,
                        content_index: 0,
                        audio_end_ms: elapsedTime
                    }));
                }
                connection.send(JSON.stringify({ event: 'clear', streamSid }));
                markQueue = [];
                lastAssistantItem = null;
                responseStartTimestampTwilio = null;
            }
        };

        openAiWs.on('open', () => {
            console.log('Connected to OpenAI Realtime API');
            setTimeout(initializeSession, 100);
        });

        openAiWs.on('message', (data) => {
            try {
                const response = JSON.parse(data);
                if (LOG_EVENT_TYPES.includes(response.type)) {
                    console.log(`OpenAI event: ${response.type}`);
                }
                if (response.type === 'response.audio.delta' && response.delta) {
                    connection.send(JSON.stringify({
                        event: 'media',
                        streamSid,
                        media: { payload: response.delta }
                    }));
                    if (!responseStartTimestampTwilio) responseStartTimestampTwilio = latestMediaTimestamp;
                    if (response.item_id) lastAssistantItem = response.item_id;
                    if (streamSid) {
                        connection.send(JSON.stringify({ event: 'mark', streamSid, mark: { name: 'responsePart' } }));
                        markQueue.push('responsePart');
                    }
                }
                if (response.type === 'input_audio_buffer.speech_started') {
                    handleSpeechStartedEvent();
                }
            } catch (e) {
                console.error('Error processing OpenAI message:', e);
            }
        });

        connection.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                switch (data.event) {
                    case 'media':
                        latestMediaTimestamp = data.media.timestamp;
                        if (openAiWs.readyState === WebSocket.OPEN) {
                            openAiWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: data.media.payload }));
                        }
                        break;
                    case 'start':
                        streamSid = data.start.streamSid;
                        console.log('Stream started:', streamSid);
                        responseStartTimestampTwilio = null;
                        latestMediaTimestamp = 0;
                        break;
                    case 'mark':
                        if (markQueue.length > 0) markQueue.shift();
                        break;
                }
            } catch (e) {
                console.error('Error processing Twilio message:', e);
            }
        });

        connection.on('close', () => {
            openAiWs.close();
            console.log('Call ended');
        });

        openAiWs.on('close', () => console.log('OpenAI WS closed'));
        openAiWs.on('error', (e) => console.error('OpenAI WS error:', e));
    });
});

fastify.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
    if (err) { console.error(err); process.exit(1); }
    console.log(`Sipho server running on port ${PORT}`);
});
