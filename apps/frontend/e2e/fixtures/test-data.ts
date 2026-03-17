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
      name: 'Quality AV1 for Anime',
      preset: 'QUALITY_AV1',
      target_codec: 'AV1',
      crf: 28,
      library_id: null,
      device_profiles: {
        appleTV: false,
        roku: false,
        web: true,
        chromecast: false,
      },
      ffmpeg_flags: null,
      audio_handling: 'COPY',
      completed_jobs: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'policy-2',
      name: 'Default - Universal H.265 (Recommended)',
      preset: 'BALANCED_HEVC',
      target_codec: 'HEVC',
      crf: 20,
      library_id: null,
      device_profiles: {
        appleTV: true,
        roku: true,
        web: true,
        chromecast: true,
      },
      ffmpeg_flags: null,
      audio_handling: 'COPY',
      completed_jobs: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],

  presets: [
    {
      preset: 'BALANCED_HEVC',
      name: 'Balanced HEVC (Recommended)',
      description: 'Best balance of quality and file size. Works on most devices.',
      codec: 'HEVC',
      crf: 23,
      use_case: 'General purpose encoding for all content types',
      icon: '⚖️',
      recommended: true,
    },
    {
      preset: 'QUALITY_AV1',
      name: 'Quality AV1',
      description: 'Maximum quality with latest AV1 codec. Requires modern devices.',
      codec: 'AV1',
      crf: 28,
      use_case: 'High quality archival and future-proofing',
      icon: '💎',
      recommended: false,
    },
  ],
};
