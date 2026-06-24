// react-native-webrtc is a native module that throws on import under Jest.
// Stub the symbols App imports so the component tree can render in tests.
jest.mock('react-native-webrtc', () => ({
  MediaStream: class {},
  MediaStreamTrack: class {},
  mediaDevices: { getUserMedia: jest.fn() },
  registerGlobals: jest.fn(),
}));

// App fetches the meetings list on mount; stub fetch so the render settles
// deterministically instead of hitting the network after the test tears down.
global.fetch = jest.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve([]) }),
);
