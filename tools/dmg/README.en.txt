Claude in Safari (unofficial) - https://github.com/KLon777/claude-in-safari

1. Double-click "Sign with my certificate" (right-click > Open if macOS blocks it). The wizard copies the app to
   Applications, guides you through getting a free Apple Development certificate (needs Xcode + your Apple ID),
   signs the app and checks the result. Alternatively use Safari > Develop > Allow Unsigned Extensions
   (repeat after each Safari restart) - see the README.
2. Safari > Settings > Extensions: enable Claude in Safari, allow all websites.
3. The wizard copies "Claude Safari Server" to /Users/Shared and adds it to Claude Desktop's config by itself.
   Without the wizard: copy the folder there manually (Finder > Go > Go to Folder, Shift+Cmd+G), then run in Terminal:
   "/Users/Shared/Claude Safari Server/claude-safari-server" --install
4. Restart Claude Desktop.

Full guide with screenshots: README.en.md in the repository.
