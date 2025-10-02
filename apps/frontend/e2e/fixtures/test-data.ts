/**
 * Test data fixtures for E2E tests
 */

export const testLibrary = {
  name: 'Test Library',
  path: '/media/test',
  mediaType: 'MOVIE',
  nodeId: 'test-node-1',
};

export const testNode = {
  name: 'Test Node',
  hostname: 'localhost',
  port: 3000,
  role: 'MAIN',
  status: 'ONLINE',
};

export const testPolicy = {
  name: 'Test Policy',
  targetCodec: 'HEVC',
  crf: 23,
  preset: 'medium',
  libraryId: 'test-library-1',
};

export const testJob = {
  libraryId: 'test-library-1',
  policyId: 'test-policy-1',
  filePath: '/media/test/video.mp4',
  stage: 'QUEUED',
};

/**
 * API responses for mocking
 */
export const mockApiResponses = {
  libraries: [
    {
      id: '1',
      name: 'Movies',
      path: '/media/movies',
      mediaType: 'MOVIE',
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      node: {
        id: 'node-1',
        name: 'Main Node',
        status: 'ONLINE',
      },
    },
  ],

  nodes: [
    {
      id: 'node-1',
      name: 'Main Node',
      hostname: 'localhost',
      port: 3000,
      role: 'MAIN',
      status: 'ONLINE',
      lastHeartbeat: new Date().toISOString(),
    },
  ],

  policies: [
    {
      id: 'policy-1',
      name: 'H.265 High Quality',
      targetCodec: 'HEVC',
      crf: 20,
      preset: 'slow',
      library: {
        id: '1',
        name: 'Movies',
      },
    },
  ],
};
