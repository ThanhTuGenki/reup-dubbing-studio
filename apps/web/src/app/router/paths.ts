export const paths = {
  foundation: '/', discovery: '/discovery', queue: '/queue', library: '/library', libraryVideo: '/library/:videoId',
  publishing: '/publishing', workers: '/workers', channelProfiles: '/channel-profiles', voices: '/voices', settings: '/settings',
} as const;

export const reservedPaths = Object.values(paths).filter((path) => path !== paths.foundation);
