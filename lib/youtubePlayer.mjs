export function youtubePlayerExperience(show, broadcast) {
  if (!show) return { status: 'NOT_FOUND', message: 'This show is unavailable.' };
  if (!broadcast?.youtube_broadcast_id) return { status: 'NOT_CONFIGURED' };
  if (broadcast.privacy_status === 'private') return { status: 'PRIVATE', message: 'This YouTube broadcast is private.' };
  if (broadcast.state === 'failed') return { status: 'UNAVAILABLE', message: 'This broadcast is temporarily unavailable.' };
  const videoId = String(broadcast.youtube_broadcast_id);
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return { status: 'UNAVAILABLE', message: 'This broadcast has an invalid player reference.' };
  return {
    status: broadcast.state === 'complete' || show.state === 'ended' ? 'ENDED' : broadcast.state === 'live' ? 'LIVE' : 'WAITING',
    videoId,
    showId: show.id,
    title: show.title || 'Loudentify Live',
    roomName: show.room_name,
  };
}
