// Test v2 API full flow
const https = require('https');

function post(url, body) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, r => { let d=''; r.on('data', c => d+=c); r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: d })); });
    req.on('error', rej);
    req.write(data);
    req.end();
  });
}

function getStream(url, onLine) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname, headers: { Accept: 'text/event-stream' } }, r => {
      if (r.statusCode !== 200) { reject(new Error('HTTP ' + r.statusCode)); return; }
      let buf = '';
      r.on('data', c => {
        buf += c.toString();
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const l of lines) onLine(l);
      });
      r.on('end', resolve);
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const params = {
    prompt: 'a cute cat sitting on a windowsill',
    mode: 'Create an image',
    reference: null,
    aspect_ratio: 'Square \u00b7 1:1',
    steps: 40,
    seed: 42,
    randomize_seed: true
  };

  try {
    console.log('POST v2/generate body:', JSON.stringify(params));
    const joinRes = await post('https://assembledchaos-qwen-image-2-1-studio.hf.space/gradio_api/call/v2/generate', params);
    console.log('JOIN status:', joinRes.status);
    console.log('JOIN body:', joinRes.body);
    const eventId = JSON.parse(joinRes.body).event_id;
    console.log('event_id:', eventId);

    console.log('\n--- SSE stream ---');
    await getStream('https://assembledchaos-qwen-image-2-1-studio.hf.space/gradio_api/call/generate/' + eventId, (line) => {
      if (line.trim()) console.log(line);
    });
    console.log('\n--- stream ended ---');
  } catch(e) {
    console.error('ERR:', e.message);
  }
})();
