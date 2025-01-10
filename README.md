# Net Switch: Isolate Apps from Internet Access
Net Switch is a Magisk module to isolate apps from accessing the internet on your Android device. This tool gives you complete control over which apps can send or receive data, improving security, privacy, and saving bandwidth.

Fully standalone, Operates fully on WebUI.

## Supported Root Managers
- [APatch](https://github.com/bmax121/APatch) 
- [KernelSU](https://github.com/tiann/KernelSU)
- [Magisk](https://github.com/topjohnwu/Magisk)  <sup>([no WebUI](https://github.com/topjohnwu/Magisk/issues/8609#event-15568590949)👀)</sup>

### WebUI on Magisk
Magisk doesn't support module WebUI on their manager, but you can use one of these app to open Net Switch WebUI.

- [KsuWebUI](https://github.com/5ec1cff/KsuWebUIStandalone)
- [MMRL](https://github.com/DerGoogler/MMRL)   <sup>👍</sup>

## Usage
- Flash Net Switch Module
- Reboot
- Open Net Switch WebUI
- Select apps you wish to isolate. Changes are applied immediately, no need to reboot.

## *Terminal Usage
- open Termux or Any Terminal with root access and run
```
netstat block <package> | to block packages
netstate unblock <package> | to unblock packages
netstat list | to show currently blocked packages
netstat unblock all | to unblock all restricted packages.
```


## Links
- Download [here](https://github.com/Rem01Gaming/net-switch/releases)
- [Telegram Channel](https://t.me/rem01schannel)

## Help and Support
Report [here](https://github.com/Rem01Gaming/net-switch/issues) if you encounter any issues.

[Pull requests](https://github.com/Rem01Gaming/net-switch/pulls) are always welcome.
