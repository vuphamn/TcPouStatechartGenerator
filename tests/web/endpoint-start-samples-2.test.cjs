// Every second sample of two: transitions' start endpoints dragged onto another state, each undone
// (endpoint-start-samples.part.cjs says what is checked)
// runner-timeout: 450 (5 drops in each of half the samples, each undone)
process.env.KSS_ENDPOINT_PART = '2/2';
require('./endpoint-start-samples.part.cjs');
