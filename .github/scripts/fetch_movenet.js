// 在 CI 中将 MoveNet 单姿态 Lightning 模型下载到本地（fitness-app/vendor/movenet），
// 使 APK 运行时完全离线，不依赖任何外网 CDN（国内用户也不会因 jsdelivr/google 被墙而失败）。
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const OUT = path.resolve(__dirname, '../../fitness-app/vendor/movenet');
fs.mkdirSync(OUT, { recursive: true });

function get(url, redirects = 8) {
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

async function downloadWeights(modelJson, base, label) {
  for (const group of modelJson.weightsManifest || []) {
    for (const p of group.paths || []) {
      const url = /^https?:\/\//.test(p) ? p : (base ? base + p : null);
      if (!url) { console.log('skip weight (no resolvable url):', p); continue; }
      const buf = await get(url);
      fs.writeFileSync(path.join(OUT, path.basename(p)), buf);
      console.log('weight <-', path.basename(p), '(' + (buf.length / 1048576).toFixed(2) + 'MB) [' + label + ']');
    }
  }
}

async function main() {
  // 主源与兜底均来自 TFHub（与 @tensorflow-models/pose-detection 内部默认来源一致）
  const srcModel = 'https://tfhub.dev/google/tfjs-model/movenet/singlepose/lightning/4/model.json';
  const srcZip = 'https://tfhub.dev/google/tfjs-model/movenet/singlepose/lightning/4?tfjs-format=file';

  try {
    const modelJsonBuf = await get(srcModel);
    const base = srcModel.substring(0, srcModel.lastIndexOf('/') + 1);
    fs.writeFileSync(path.join(OUT, 'model.json'), modelJsonBuf);
    console.log('model.json <-', srcModel);
    await downloadWeights(JSON.parse(modelJsonBuf.toString()), base, 'tfhub-modeljson');
  } catch (e) {
    console.log('tfhub model.json 失败:', e.message, '=> 尝试 zip 兜底');
    const zip = await get(srcZip);
    const zipPath = path.join(OUT, 'movenet.zip');
    fs.writeFileSync(zipPath, zip);
    execSync('unzip -o ' + JSON.stringify(zipPath) + ' -d ' + JSON.stringify(OUT), { stdio: 'inherit' });
    const found = execSync('find ' + JSON.stringify(OUT) + ' -name model.json').toString().trim().split('\n')[0];
    if (!found) throw new Error('zip 中未找到 model.json');
    const modelJson = JSON.parse(fs.readFileSync(found).toString());
    fs.copyFileSync(found, path.join(OUT, 'model.json'));
    // 权重若未随 zip 解压，则按相对路径补全
    await downloadWeights(modelJson, path.dirname(found) + '/', 'tfhub-zip');
  }
  console.log('MoveNet model vendored ->', OUT);
}
main().catch((e) => { console.error('MODEL FETCH FAILED:', e.message); process.exit(1); });
