package ch.duartesantos.opengym;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

/**
 * Opens Android's per-app unknown-source setting when needed, then the package installer
 * for an APK stored in the app's private cache directory.
 *
 * Usage from JS:
 *   import { registerPlugin } from '@capacitor/core';
 *   const Install = registerPlugin('Install');
 *   await Install.installApk({ fileName: 'nextuin-gym-update.apk' });
 */
@CapacitorPlugin(name = "Install")
public class InstallPlugin extends Plugin {

    @PluginMethod
    public void installApk(PluginCall call) {
        String fileName = call.getString("fileName");
        if (fileName == null || fileName.isEmpty()) {
            call.reject("fileName is required");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !canRequestInstalls()) {
            Intent settings = new Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName())
            );
            startActivityForResult(call, settings, "installPermissionCallback");
            return;
        }

        openInstaller(call, fileName);
    }

    @ActivityCallback
    private void installPermissionCallback(PluginCall call, ActivityResult result) {
        String fileName = call.getString("fileName");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !canRequestInstalls()) {
            call.reject("Install permission was not granted. Allow Nextuin Gym to install APKs in Android Settings.");
            return;
        }
        openInstaller(call, fileName);
    }

    private boolean canRequestInstalls() {
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    private void openInstaller(PluginCall call, String fileName) {
        File file = new File(getContext().getCacheDir(), fileName);
        if (!file.exists()) {
            call.reject("APK file not found: " + fileName);
            return;
        }

        Uri uri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                file
        );

        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);

        getContext().startActivity(intent);
        call.resolve();
    }
}
