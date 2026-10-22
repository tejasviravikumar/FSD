import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

const PLAYER_ERRORS = {
  2: 'This video has an invalid YouTube ID.',
  5: 'This video cannot be played in the embedded player.',
  100: 'This video was removed or is private.',
  101: 'The video owner does not allow playback on other websites.',
  150: 'The video owner does not allow playback on other websites.',
  153: 'YouTube could not verify this website. Check that the page is opened from its normal site address.',
}

// ---------------------------------------------------------------------------
// Load the YouTube IFrame API once per page
// ---------------------------------------------------------------------------
let playerApiPromise

function loadPlayerApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT)

  if (!playerApiPromise) {
    playerApiPromise = new Promise(resolve => {
      const previous = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        previous?.()
        resolve(window.YT)
      }

      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const script = document.createElement('script')
        script.src = 'https://www.youtube.com/iframe_api'
        document.head.appendChild(script)
      }
    })
  }
  return playerApiPromise
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function YouTubeLesson({
  videoId,
  assignmentId,
  module,
  initialWatched = 0,
  initialPosition = 0,
  onProgress,
  notify,
}) {
  const [playerError, setPlayerError] = useState('')
  const host = useRef(null)
  const player = useRef(null)
  const onProgressRef = useRef(onProgress)
  const notifyRef = useRef(notify)

  // Keep refs pointed at the latest callbacks for use inside the player
  onProgressRef.current = onProgress
  notifyRef.current = notify

  useEffect(() => {
    setPlayerError('')
    let timer
    let active = true
    let lastPosition = initialPosition
    let lastTick = 0
    let watchedSeconds = initialWatched

    const stopTimer = () => {
      if (timer) window.clearInterval(timer)
      timer = null
    }

    // Runs every 10s while playing: accumulates watched time and saves progress
    const saveProgress = async () => {
      if (!active || !player.current?.getDuration) return

      const now = Date.now()
      const position = player.current.getCurrentTime() || 0
      const duration = player.current.getDuration() || module.durationSeconds || 0
      const elapsed = Math.max(0, (now - lastTick) / 1000)
      const watchedDelta = Math.min(Math.max(0, position - lastPosition), elapsed + 2)

      watchedSeconds = Math.min(duration, watchedSeconds + watchedDelta)
      lastPosition = position
      lastTick = now
      if (!duration) return

      try {
        const result = await api.put(
          `/assignments/${assignmentId}/modules/${module._id}/progress`,
          { watchedSeconds, lastPositionSeconds: position, durationSeconds: duration },
        )
        if (result.data?.progress?.completed) {
          onProgressRef.current?.()
          stopTimer()
          player.current.pauseVideo()
        }
      } catch (error) {
        notifyRef.current?.({
          message: error.message || 'Could not save video progress',
          type: 'error',
        })
      }
    }

    loadPlayerApi()
      .then(YT => {
        if (!active || !host.current) return

        player.current = new YT.Player(host.current, {
          videoId,
          host: 'https://www.youtube-nocookie.com',
          playerVars: { playsinline: 1, origin: window.location.origin, rel: 0 },
          events: {
            onReady: () => {
              if (initialPosition > 0) player.current.seekTo(initialPosition, true)
            },

            onError: event => {
              setPlayerError(
                PLAYER_ERRORS[event.data] ||
                  `YouTube could not play this video (error ${event.data}).`,
              )
            },

            onStateChange: event => {
              if (event.data === YT.PlayerState.PLAYING && !timer) {
                lastPosition = player.current.getCurrentTime() || 0
                lastTick = Date.now()
                timer = window.setInterval(saveProgress, 10_000)
              } else if (timer) {
                stopTimer()
              }
            },
          },
        })
      })
      .catch(() =>
        notifyRef.current?.({ message: 'YouTube player could not be loaded', type: 'error' }),
      )

    return () => {
      active = false
      stopTimer()
      player.current?.destroy?.()
      player.current = null
    }
  }, [videoId, assignmentId, module._id, module.durationSeconds])

  return (
    <>
      <div className="video-frame">
        <div ref={host} />
      </div>

      {playerError && (
        <div className="video-error" role="alert">
          <p>{playerError}</p>
          <a
            href={`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`}
            target="_blank"
            rel="noreferrer"
          >
            Watch on YouTube
          </a>
        </div>
      )}
    </>
  )
}