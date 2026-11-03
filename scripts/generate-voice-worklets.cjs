const fs = require('node:fs');
const path = require('node:path');

const packageDirectory = path.dirname(path.dirname(require.resolve('@elevenlabs/client')));
const packageInfo = JSON.parse(fs.readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'));
if (packageInfo.version !== '1.12.0') throw new Error('Review the voice worklet integration before changing the ElevenLabs client version.');
const destination = path.join(process.cwd(), 'public', 'voice-worklets');
fs.mkdirSync(destination, { recursive: true });
for (const name of ['rawAudioProcessor', 'audioConcatProcessor']) {
  const generated = fs.readFileSync(path.join(packageDirectory, 'dist', 'platform', 'web', `${name}.generated.js`), 'utf8');
  const match = generated.match(new RegExp(`createWorkletModuleLoader\\("${name}",\\s*// language=JavaScript\\s*\x60([^\x60]*)\x60\\);`));
  if (!match || match[1].includes('${') || !match[1].includes(`registerProcessor("${name}"`)) throw new Error(`Invalid ${name} worklet source.`);
  fs.writeFileSync(path.join(destination, `${name}.js`), match[1]);
}
fs.copyFileSync(path.join(packageDirectory, 'LICENSE'), path.join(destination, 'LICENSE'));
