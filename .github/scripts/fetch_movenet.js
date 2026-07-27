// 在 CI 中将 MoveNet 单姿态 Lightning 模型下载到本地（fitness-app/vendor/movenet），
// 使 APK 运行时完全离线，不依赖任何外网 CDN（国内用户也不会因 jsdelivr/google 被墙而失败）。
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const OUT = path.resolve(__dirname, '../../fitness-app/vendor/movenet');
fs.mkdirSync(OUT, { recursive: true });

function get(url, redirects = 5) {
  return new Promise((res, rej) => {
    https.get(url, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location && redirects > 0) {
        r.resume();
        const next = new URL(r.headers.location, url).href;
        return get(next, redirects - 1).then(res, rej);
      }
      if (r.statusCode !== 200) { r.resume(); return rej(new Error('HTTP ' + r.statusCode + ' @ ' + url)); }
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => res(Buffer.concat(chunks)));
    }).on('error', rej);
  });
}

async function main() {
  const sources = [
    'https://storage.googleapis.com/tfjs-models/savedmodel/movenet/singlepose/lightning/model.json',
    'https://storage.googleapis.com/tfjs-models/movenet/singlepose/lightning/model.json',
  ];
  let modelJsonBuf = null, base = null;
  for (const s of sources) {
    try { modelJsonBuf = await get(s); base = s.substring(0, s.lastIndexOf('/') + 1); console.log('model.json <-', s); break; }
    catch (e) { console.log('skip', s, ':', e.message); }
  }
  if (!modelJsonBuf) {
    // 兜底：从 TFHub 拉取可下载的 zip 包
    console.log('trying TFHub zip fallback...');
    const zip = await get('https://tfhub.dev/google/tfjs-model/movenet/singlepose/lightning/4?tfjs-format=file');
    const zipPath = path.join(OUT, 'movenet.zip');
    fs.writeFileSync(zipPath, zip);
    execSync('unzip -o ' + JSON.stringify(zipPath) + ' -d ' + JSON.stringify(OUT), { stdio: 'inherit' });
    const found = execSync('find ' + JSON.stringify(OUT) + ' -name model.json').toString().trim().split('\n')[0];
    if (!found) throw new Error('TFHub zip 中未找到 model.json');
    modelJsonBuf = fs.readFileSync(found);
    fs.copyFileSync(found, path.join(OUT, 'model.json'));
    console.log('model.json <- tfhub zip @', found);
    base = null; // 权重已随 zip 解压到 OUT
  } else {
    fs.writeFileSync(path.join(OUT, 'model.json'), modelJsonBuf);
  }
  const modelJson = JSON.parse(modelJsonBuf.toString());
  for (const group of modelJson.weightsManifest || []) {
    for (const p of group.paths || []) {
      if (base) {
        const buf = await get(base + p);
        fs.writeFileSync(path.join(OUT, p), buf);
        console.log('weight <-', p, '(' + (buf.length / 1048576).toFixed(2) + 'MB)');
      }
    }
  }
  console.log('MoveNet model vendored ->', OUT);
}
main().catch((e) => { console.error('MODEL FETCH FAILED:', e.message); process.exit(1); });
