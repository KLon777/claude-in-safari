-- Claude in Safari: guided signing with YOUR OWN free Apple Development certificate (native macOS dialogs).
-- TEMPLATE: tools/gen_wizard.py fills the double-at placeholders per language and writes build/wizards/sign-wizard.<lang>.applescript
-- Build: python3 tools/gen_wizard.py && osacompile -o "<name>.app" build/wizards/sign-wizard.<lang>.applescript
-- Test mode (no clicks): CIS_TEST=1 [CIS_APP=/path/to/app] [CIS_IDENTITY_FILTER=...] osascript build/wizards/sign-wizard.<lang>.applescript
property T : "@@title@@"
property appName : "Claude in Safari.app"
property testMode : false
property idFilter : "Apple Development"
property bCancel : "@@btn_cancel@@"
property bStart : "@@btn_start@@"
property bCheck : "@@btn_check@@"
property bStore : "@@btn_store@@"
property bXcode : "@@btn_xcode@@"
property bSign : "@@btn_sign@@"
property bDone : "@@btn_done@@"
property bOpenApp : "@@btn_open_app@@"

on getEnv(varName)
	try
		return system attribute varName
	on error
		return ""
	end try
end getEnv

on askUser(msg, btnList, defBtn)
	if testMode then return defBtn
	activate
	with timeout of 86400 seconds
		return button returned of (display dialog msg with title T buttons btnList default button defBtn with icon note)
	end timeout
end askUser

on sh(cmd)
	with timeout of 86400 seconds
		return do shell script cmd
	end timeout
end sh

on shAdmin(cmd)
	return do shell script cmd with administrator privileges
end shAdmin

on findIdentity()
	try
		return sh("security find-identity -v -p codesigning 2>/dev/null | grep " & quoted form of idFilter & " | head -1 | awk '{print $2}'")
	on error
		return ""
	end try
end findIdentity

on hasXcode()
	return (sh("DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild -version >/dev/null 2>&1 && echo y || echo n") is "y")
end hasXcode

-- Apple's intermediate certificate: without it the identity is listed only without -v.
on fixIntermediate()
	try
		if (sh("security find-identity -p codesigning 2>/dev/null | grep -c " & quoted form of idFilter & " || true") as integer) > 0 then
			sh("curl -fsSL -o /tmp/AppleWWDRCAG3.cer https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer && security import /tmp/AppleWWDRCAG3.cer -k ~/Library/Keychains/login.keychain-db")
		end if
	end try
end fixIntermediate

on run
	set testMode to (getEnv("CIS_TEST") is not "")
	if getEnv("CIS_IDENTITY_FILTER") is not "" then set idFilter to getEnv("CIS_IDENTITY_FILTER")
	try
		-- the user may spend a long time in Xcode / App Store: without this AppleScript aborts any call after 2 minutes (error -1712)
		with timeout of 86400 seconds
			my wizard()
		end timeout
	on error msg number n
		if n is -128 then return -- Cancel
		display dialog "@@err_title@@" & return & msg with title T buttons {"OK"} default button "OK" with icon stop
	end try
end run

on wizard()
	set target to getEnv("CIS_APP")
	set here to sh("dirname " & quoted form of POSIX path of (path to me))
	set r0 to askUser("@@intro@@", {bCancel, bStart}, bStart)
	if r0 is bCancel then error number -128

	-- Step 1: the app goes to /Applications
	if target is "" then
		set src to here & "/" & appName
		try
			sh("test -d " & quoted form of src)
		on error
			error "@@notfound_a@@" & appName & "@@notfound_b@@"
		end try
		set target to "/Applications/" & appName
		try
			sh("rm -rf " & quoted form of target & " && cp -R " & quoted form of src & " /Applications/")
		on error
			shAdmin("rm -rf " & quoted form of target & " && cp -R " & quoted form of src & " /Applications/")
		end try
		-- the MCP server folder goes to /Users/Shared (no password needed)
		try
			sh("test -d " & quoted form of (here & "/Claude Safari Server") & " && rm -rf '/Users/Shared/Claude Safari Server' && cp -R " & quoted form of (here & "/Claude Safari Server") & " /Users/Shared/")
			sh("'/Users/Shared/Claude Safari Server/claude-safari-server' --install")
		end try
	end if

	-- Step 2: the certificate (only Xcode can issue it, with the user's own Apple ID)
	set ident to findIdentity()
	repeat while ident is ""
		if not hasXcode() then
			set r to askUser("@@xcode_step@@", {bCancel, bCheck, bStore}, bStore)
			if r is bCancel then error number -128
			if r is bStore then sh("open macappstore://apps.apple.com/app/id497799835")
			if testMode then error "@@err_no_xcode@@"
		else
			set r to askUser("@@cert_step@@", {bCancel, bXcode, bCheck}, bCheck)
			if r is bCancel then error number -128
			if r is bXcode then
				sh("open -a Xcode")
				delay 6
			end if
			if testMode then error "@@err_no_cert@@"
		end if
		fixIntermediate()
		set ident to findIdentity()
		if ident is "" and (r is bCheck) then display notification "@@notif_nocert@@" with title T
	end repeat

	-- Step 3: sign (extension first, then the app, keeping the sandbox entitlements)
	askUser("@@sign_ready@@", {bSign}, bSign)
	set progress total steps to 3
	set progress completed steps to 0
	set progress description to "@@progress@@"
	set q to quoted form of target
	sh("xattr -cr " & q)
	set progress completed steps to 1
	sh("for A in " & q & "/Contents/PlugIns/*.appex " & q & "; do codesign --force --sign " & ident & " --preserve-metadata=entitlements --options runtime \"$A\" 2>&1 || exit 1; done")
	set progress completed steps to 2
	sh("codesign --verify --deep --strict " & q & " 2>&1")
	set progress completed steps to 3

	-- Step 4: done
	set r to askUser("@@done@@", {bDone, bOpenApp}, bOpenApp)
	if r is bOpenApp and not testMode then sh("open " & quoted form of target)
	if testMode then return "TEST-OK signed with " & ident
end wizard
