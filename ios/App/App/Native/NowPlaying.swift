import Foundation
import MediaPlayer
import AVFoundation
import UIKit

/// Focus music on the lock screen and in Control Center (play/pause, previous, next), and an audio
/// session that keeps the music playing in the background.
enum NowPlaying {
    private static var registered = false

    static func activateAudioSession() {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    static func update(has: Bool, playing: Bool, title: String, category: String) {
        registerCommands()
        let center = MPNowPlayingInfoCenter.default()
        guard has else { center.nowPlayingInfo = nil; center.playbackState = .stopped; return }
        var info: [String: Any] = [MPMediaItemPropertyTitle: title, MPMediaItemPropertyArtist: category, MPMediaItemPropertyAlbumTitle: "Cadence focus music",
                                   MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0]
        if let img = UIImage(named: "MusicArt") { info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: img.size) { _ in img } }
        center.nowPlayingInfo = info
        center.playbackState = playing ? .playing : .paused
        // Play without mixing so the lock screen shows Cadence as the active player.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: playing ? [] : [.mixWithOthers])
    }

    private static func registerCommands() {
        guard !registered else { return }
        registered = true
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { _ in CadenceActions.handle("musicToggle"); return .success }
        c.pauseCommand.addTarget { _ in CadenceActions.handle("musicToggle"); return .success }
        c.togglePlayPauseCommand.addTarget { _ in CadenceActions.handle("musicToggle"); return .success }
        c.nextTrackCommand.addTarget { _ in CadenceActions.handle("musicNext"); return .success }
        c.previousTrackCommand.addTarget { _ in CadenceActions.handle("musicPrev"); return .success }
    }
}
