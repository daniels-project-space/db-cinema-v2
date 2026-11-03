const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'test-membership-browser.cjs'), 'utf8');
const connect = new Function('require', source.slice(0, source.indexOf('const { ConvexHttpClient }')) + '\nreturn connect;')(require);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const client = await connect();
  try {
    await client.cmd('Page.enable');
    await client.cmd('Page.navigate', { url: process.env.DBC_TEST_URL || 'http://127.0.0.1:41901/' });
    for (let attempt = 0; attempt < 100 && !(await client.evaluate('document.readyState === "complete"')); attempt++) await delay(100);
    const result = await client.evaluate(`(async () => {
      const audio = new AudioContext();
      const generated = URL.createObjectURL(new Blob(['class Probe extends AudioWorkletProcessor { process(){ return true; } } registerProcessor("probe", Probe);'], {type:'application/javascript'}));
      let blocked = false;
      try { await audio.audioWorklet.addModule(generated); } catch { blocked = true; }
      URL.revokeObjectURL(generated);
      await audio.audioWorklet.addModule('/voice-worklets/rawAudioProcessor.js?v=1.12.0');
      await audio.audioWorklet.addModule('/voice-worklets/audioConcatProcessor.js?v=1.12.0');
      const input = new AudioWorkletNode(audio, 'rawAudioProcessor');
      const output = new AudioWorkletNode(audio, 'audioConcatProcessor');
      input.disconnect(); output.disconnect(); await audio.close();
      return {blocked};
    })()`);
    assert.equal(result.blocked, true, 'CSP still blocks arbitrary blob scripts');
    console.log('PASS real browser audio worklets load from this site while arbitrary blob scripts remain blocked; no provider call or microphone access.');
  } finally {
    client.close();
    await fetch(`${process.env.DBC_CDP_URL || 'http://localhost:9224'}/json/close/${client.tabId}`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
