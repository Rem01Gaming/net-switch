ISOLATED="/data/adb/net-switch/isolated.json"
if [ ! -f $ISOLATED ]; then
	mkdir $(dirname $ISOLATED)
	touch $ISOLATED
fi

if [ "$KSU" = "true" ] || [ "$APATCH" = "true" ]; then
	rm $MODPATH/action.sh
fi
set_perm_recursive "$MODPATH/system" 0 0 0755 0755
