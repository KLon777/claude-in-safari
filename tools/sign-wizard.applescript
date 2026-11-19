-- Claude in Safari: guided signing with YOUR OWN free Apple Development certificate (native macOS dialogs).
-- Build: osacompile -o "Sign with my certificate.app" tools/sign-wizard.applescript
-- Test mode (no clicks): CIS_TEST=1 [CIS_APP=/path/to/app] [CIS_IDENTITY_FILTER=...] osascript tools/sign-wizard.applescript
property T : "Claude in Safari — подпись / signing"
property appName : "Claude in Safari.app"
property testMode : false
property idFilter : "Apple Development"

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
		display dialog "Ошибка / Error:" & return & msg with title T buttons {"OK"} default button "OK" with icon stop
	end try
end run

on wizard()
	set target to getEnv("CIS_APP")
	set here to sh("dirname " & quoted form of POSIX path of (path to me))
	set r0 to askUser("Это мастер подписи приложения «Claude in Safari» вашим собственным бесплатным сертификатом Apple Development." & return & "This wizard signs the app with your own free Apple Development certificate." & return & return & "Мастер скопирует приложение в «Программы» и подпишет его, а папку «Claude Safari Server» положит в /Users/Shared. / It copies the app to Applications, signs it, and puts the server folder into /Users/Shared." & return & return & "Нужен Apple ID. / You need an Apple ID.", {"Отмена / Cancel", "Начать / Start"}, "Начать / Start")
	if r0 is "Отмена / Cancel" then error number -128

	-- Step 1: the app goes to /Applications
	if target is "" then
		set src to here & "/" & appName
		try
			sh("test -d " & quoted form of src)
		on error
			error "Не нахожу «" & appName & "» рядом с мастером. / '" & appName & "' not found next to the wizard."
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
			set r to askUser("Шаг 1 из 2: установите Xcode." & return & "Он бесплатный (~10 ГБ) и нужен только чтобы получить сертификат." & return & return & "Step 1 of 2: install Xcode (free, ~10 GB). It is only needed to obtain the certificate.", {"Отмена / Cancel", "Проверить / Check", "Открыть App Store / Open App Store"}, "Открыть App Store / Open App Store")
			if r is "Отмена / Cancel" then error number -128
			if r starts with "Открыть" then sh("open macappstore://apps.apple.com/app/id497799835")
			if testMode then error "Xcode не установлен / Xcode is not installed."
		else
			set r to askUser("Шаг 2 из 2: выпустите сертификат в Xcode." & return & return & ¬
				"1. Xcode ➜ Settings… (⌘,) ➜ Apple Accounts" & return & ¬
				"2. Sign In… ➜ войдите своим Apple ID / sign in" & return & ¬
				"3. Выберите свой аккаунт ➜ Manage Certificates…" & return & ¬
				"4. Внизу слева «+» ➜ Apple Development" & return & return & ¬
				"Потом нажмите «Проверить». / Then click Check." & return & return & "Окно мастера скрылось? Нажмите его значок в Dock. / Window hidden? Click its Dock icon.", {"Отмена / Cancel", "Открыть Xcode / Open Xcode", "Проверить / Check"}, "Проверить / Check")
			if r is "Отмена / Cancel" then error number -128
			if r starts with "Открыть" then
				sh("open -a Xcode")
				delay 6
			end if
			if testMode then error "Сертификат не найден / No certificate found."
		end if
		fixIntermediate()
		set ident to findIdentity()
		if ident is "" and (r starts with "Проверить") then display notification "Сертификат пока не найден / Certificate not found yet" with title T
	end repeat

	-- Step 3: sign (extension first, then the app, keeping the sandbox entitlements)
	askUser("Сертификат найден. Сейчас приложение будет подписано." & return & "macOS может спросить доступ к ключу — нажмите «Всегда разрешать»." & return & return & "Certificate found. Signing now; if macOS asks for key access, choose Always Allow.", {"Подписать / Sign"}, "Подписать / Sign")
	set progress total steps to 3
	set progress completed steps to 0
	set progress description to "Подписываю… / Signing…"
	set q to quoted form of target
	sh("xattr -cr " & q)
	set progress completed steps to 1
	sh("for A in " & q & "/Contents/PlugIns/*.appex " & q & "; do codesign --force --sign " & ident & " --preserve-metadata=entitlements --options runtime \"$A\" 2>&1 || exit 1; done")
	set progress completed steps to 2
	sh("codesign --verify --deep --strict " & q & " 2>&1")
	set progress completed steps to 3

	-- Step 4: done
	set r to askUser("Готово: приложение подписано вашим сертификатом." & return & return & "Сервер добавлен в Claude Desktop; перезапустите Claude Desktop (⌘Q). Дальше: откройте приложение ➜ Safari ➜ Настройки ➜ Расширения ➜ включите «Claude in Safari» и разрешите все сайты." & return & "Сертификат действует год; после обновления приложения запустите мастер снова." & return & return & "Done: the app is signed. Next: open the app ➜ Safari ➜ Settings ➜ Extensions ➜ enable the extension and allow all websites.", {"Готово / Done", "Открыть приложение / Open the app"}, "Открыть приложение / Open the app")
	if r starts with "Открыть" and not testMode then sh("open " & quoted form of target)
	if testMode then return "TEST-OK signed with " & ident
end wizard
