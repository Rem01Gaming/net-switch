ISOLATED="/data/adb/net-switch/isolated.json"
if [ ! -f $ISOLATED ]; then
	mkdir $(dirname $ISOLATED)
	touch $ISOLATED
fi

if [ "$KSU" = "true" ] || [ "$APATCH" = "true" ]; then
	# remove action on APatch / KernelSU
	rm "$MODPATH/action.sh"
	# skip mount on APatch / KernelSU
	touch "$MODPATH/skip_mount"
	# symlink ourselves on $PATH
	manager_paths="/data/adb/ap/bin /data/adb/ksu/bin"
	for dir in $manager_paths; do
		if [ -d "$dir" ]; then
			echo "[+] creating symlink in $dir"
			ln -sf /data/adb/modules/net-switch/system/bin/netswitch "$dir/netswitch"
		fi
	done
fi

set_perm_recursive "$MODPATH/system" 0 0 0755 0755
