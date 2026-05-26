# typed: false
# frozen_string_literal: true

cask "uniins-claw" do
  arch arm: "aarch64", intel: "4e5fb09450a5b04862dcb01e328d387e377f435d8305a05c8073aa7986b5d796"

  version "0.1.16"
  sha256 arm:   "cf387a02740f70b428ef77b1537091690d5f75768dbba0dc3cc967bbac7ad531",
         intel: "4e5fb09450a5b04862dcb01e328d387e377f435d8305a05c8073aa7986b5d796"

  url "https://github.com/uniins-claw-ai/uniins-claw/releases/download/v#{version}/uniins-claw_#{version}_#{arch}.dmg",
      verified: "github.com/uniins-claw-ai/uniins-claw/"
  name "uniins-claw"
  desc "AI-powered work assistant with Claude Code and Codex integration"
  homepage "https://github.com/uniins-claw-ai/uniins-claw"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on macos: ">= :monterey"

  app "uniins-claw.app"

  postflight do
    # Remove quarantine attribute to prevent Gatekeeper issues
    system_command "/usr/bin/xattr",
                   args: ["-r", "-d", "com.apple.quarantine", "#{appdir}/uniins-claw.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/ai.thinkany.uniins-claw",
    "~/Library/Caches/ai.thinkany.uniins-claw",
    "~/Library/Logs/ai.thinkany.uniins-claw",
    "~/Library/Preferences/ai.thinkany.uniins-claw.plist",
    "~/Library/Saved Application State/ai.thinkany.uniins-claw.savedState",
  ]
end
