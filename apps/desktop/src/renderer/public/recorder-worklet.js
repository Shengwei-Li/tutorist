// Voice input: copies microphone samples to the page. Nothing is stored or sent anywhere from here.
class Recorder extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('tutordesk-recorder', Recorder);
