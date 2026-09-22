export const paths = {
  foundation: '/', discovery: '/discovery', queue: '/queue', library: '/library', libraryVideo: '/library/:videoId', studio: '/library/:videoId/studio',
  publishing: '/publishing', workers: '/workers', channelProfiles: '/channel-profiles', reviewPolicy: '/channel-profiles/:ownerType/:profileId/review-policy', voices: '/voices', settings: '/settings',
} as const;

export const reservedPaths = Object.values(paths).filter((path) => path !== paths.foundation);
