const https = require('https');
function fetch(url) {
  return new Promise((res, rej) => {
    https.get(url, {headers: {'Accept-Encoding':'identity', 'Cache-Control':'no-cache'}}, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>res({status:r.statusCode, headers: r.headers, d}));
    }).on('error', rej);
  });
}
(async () => {
  const r = await fetch('https://zai.wkke.eu.org/?nocache=' + Date.now());
  const scriptMatch = r.d.match(/index-([A-Za-z0-9_-]+)\.js/);
  const hash = scriptMatch ? scriptMatch[1] : 'NOT FOUND';
  console.log('HTML script hash:', hash);
  console.log('CF cache-status:', r.headers['cf-cache-status']);

  const b = await fetch('https://zai.wkke.eu.org/assets/index-' + hash + '.js');
  console.log('bundle size:', b.d.length, 'cf-cache:', b.headers['cf-cache-status']);

  const checks = [
    'qwen-image-21', 'Qwen Image 2.1', 'assembledchaos',
    'hugging-apps-qwen-image-2-1-prompt-enhancer',
    'gradio_api/call/v2', 'runGradioV2Task'
  ];
  for (const c of checks) console.log('  has', c + ':', b.d.includes(c));

  // Find label list order
  const labels = ['Z-Image Turbo', 'Z-Image', 'Qwen Image 2.1', 'Qwen Image', 'Ovis Image', 'FLUX.1 Schnell'];
  console.log('\nLabel presence:');
  for (const l of labels) console.log('  [' + (b.d.includes(l) ? 'Y' : 'N') + '] ' + l);
})();
