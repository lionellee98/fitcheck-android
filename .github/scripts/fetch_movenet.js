// 在 CI 中将 MoveNet 单姿态 Lightning 模型下载到本地（fitness-app/vendor/movenet），
// 并把 model.json 中的权重路径改写为本地相对路径，使 APK 运行时完全离线。
// 来源：TFHub 的 tfjs 模型（与 @tensorflow-models/pose-detection 默认来源一致），
// 通过 ?tfjs-format=file 拿到原始 model.json 与权重分片。
const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.resolve(__dirname, '../../fitness-app/vendor/movenet');
fs.mkdirSync(OUT, { recursive: true });

function get(url, redirects = 8) {
  return new Promise((res, rej) => {
    https.get(url, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirects > 0) {
        r.resume();
        return get(new URL(r.headers.location, url).href, redirects - 1).then(res, rej);
      }
      if (r.statusCode !== 200) { r.resume(); return rej(new Error('HTTP ' + r.statusCode + ' @ ' + url)); }
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => res(Buffer.concat(chunks)));
    }).on('error', rej);
  });
}

async function main() {
  const base = 'https://tfhub.dev/google/tfjs-model/movenet/singlepose/lightning/4';
  const modelUrl = base + '/model.json?tfjs-format=file';

  const modelJsonBuf = await get(modelUrl);
  const modelJson = JSON.parse(modelJsonBuf.toString());
  console.log('model.json <-', modelUrl);

  // 下载权重分片，并把路径改写为本地相对文件名
  let renamed = 0;
  for (const group of modelJson.weightsManifest || []) {
    const newPaths = [];
    for (const p of group.paths || []) {
      const url = /^https?:\/\//.test(p) ? p : (base + '/' + p + '?tfjs-format=file');
      const fname = path.basename(p.split('?')[0]);
      const buf = await get(url);
      fs.writeFileSync(path.join(OUT, fname), buf);
      console.log('weight <-', fname, '(' + (buf.length / 1048576).toFixed(2) + 'MB)');
      newPaths.push(fname);
      renamed++;
    }
    group.paths = newPaths;
  }

  fs.writeFileSync(path.join(OUT, 'model.json'), JSON.stringify(modelJson));
  console.log('rewrote', renamed, 'weight path(s) to local; MoveNet vendored ->', OUT);
}
main().catch((e) => { console.error('MODEL FETCH FAILED:', e.message); process.exit(1); });
