export function GET() {
  return Response.json({ transcription: Boolean(process.env.OPENAI_API_KEY?.trim()), storage: 'local-indexeddb' }, { headers: { 'Cache-Control': 'no-store' } });
}
