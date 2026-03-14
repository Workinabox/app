#import "AgentAudioPlayer.h"

#import <AVFoundation/AVFoundation.h>

@interface AgentAudioPlayer () <AVAudioPlayerDelegate>
@property(nonatomic, strong) AVAudioPlayer *player;
@property(nonatomic, copy) RCTPromiseResolveBlock pendingResolve;
@property(nonatomic, copy) RCTPromiseRejectBlock pendingReject;
@end

@implementation AgentAudioPlayer

RCT_EXPORT_MODULE();

RCT_REMAP_METHOD(playBase64Wav,
                 playBase64Wav:(NSString *)audioBase64
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  [self finishPendingPlayback];
  [self.player stop];
  self.player = nil;

  NSData *audioData = [[NSData alloc] initWithBase64EncodedString:audioBase64 options:0];
  if (audioData == nil) {
    reject(@"agent_audio_decode_failed", @"Failed to decode base64 audio", nil);
    return;
  }

  NSError *sessionError = nil;
  [[AVAudioSession sharedInstance] setCategory:AVAudioSessionCategoryPlayback error:&sessionError];
  if (sessionError != nil) {
    reject(@"agent_audio_session_failed", @"Failed to configure audio session", sessionError);
    return;
  }

  NSError *playerError = nil;
  self.player = [[AVAudioPlayer alloc] initWithData:audioData error:&playerError];
  if (self.player == nil || playerError != nil) {
    reject(@"agent_audio_player_failed", @"Failed to initialize audio player", playerError);
    return;
  }

  self.player.delegate = self;
  self.pendingResolve = resolve;
  self.pendingReject = reject;
  [self.player prepareToPlay];
  if (![self.player play]) {
    [self failPendingPlayback:@"agent_audio_playback_failed"
                      message:@"Failed to start audio playback"
                        error:nil];
  }
}

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (void)audioPlayerDidFinishPlaying:(AVAudioPlayer *)player successfully:(BOOL)flag
{
  [self finishPendingPlayback];
  self.player = nil;
}

- (void)audioPlayerDecodeErrorDidOccur:(AVAudioPlayer *)player error:(NSError *)error
{
  [self failPendingPlayback:@"agent_audio_playback_failed"
                    message:@"Audio playback failed"
                      error:error];
  self.player = nil;
}

- (void)finishPendingPlayback
{
  if (self.pendingResolve != nil) {
    self.pendingResolve(nil);
  }
  self.pendingResolve = nil;
  self.pendingReject = nil;
}

- (void)failPendingPlayback:(NSString *)code
                    message:(NSString *)message
                      error:(NSError *)error
{
  if (self.pendingReject != nil) {
    self.pendingReject(code, message, error);
  }
  self.pendingResolve = nil;
  self.pendingReject = nil;
}

@end
