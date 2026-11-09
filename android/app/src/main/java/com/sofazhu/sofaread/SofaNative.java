package com.sofazhu.sofaread;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Xml;
import android.view.KeyEvent;
import android.view.WindowManager;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.IOException;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.xmlpull.v1.XmlPullParser;

@CapacitorPlugin(name = "SofaNative")
public class SofaNative extends Plugin {
  private static final int CHUNK = 512 * 1024;
  private static final int READ = Intent.FLAG_GRANT_READ_URI_PERMISSION;
  private final Map<String, InputStream> streams = new ConcurrentHashMap<>();
  private boolean volume;

  @PluginMethod
  public void pick(PluginCall call) {
    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType("*/*");
    intent.addFlags(READ | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, Boolean.TRUE.equals(call.getBoolean("multiple")));
    startActivityForResult(call, intent, "picked");
  }

  @ActivityCallback
  private void picked(PluginCall call, ActivityResult result) {
    if (call == null) return;
    JSArray documents = new JSArray();
    Intent data = result.getData();
    if (result.getResultCode() == Activity.RESULT_OK && data != null) {
      try {
        ClipData clips = data.getClipData();
        if (clips != null) {
          for (int index = 0; index < clips.getItemCount(); index++) {
            documents.put(reference(clips.getItemAt(index).getUri()));
          }
        } else if (data.getData() != null) {
          documents.put(reference(data.getData()));
        }
      } catch (Exception error) {
        call.reject("无法保留所选文件的读取权限。", error);
        return;
      }
    }
    call.resolve(new JSObject().put("documents", documents));
  }

  private JSObject reference(Uri uri) {
    ContentResolver resolver = getContext().getContentResolver();
    String name = uri.getLastPathSegment();
    long bytes = 0;
    try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
      if (cursor != null && cursor.moveToFirst()) {
        name = cursor.getString(0);
        if (!cursor.isNull(1)) bytes = cursor.getLong(1);
      }
    }
    resolver.takePersistableUriPermission(uri, READ);
    return new JSObject().put("name", name).put("bytes", bytes).put("reference", uri.toString()).put("identity", uri.toString());
  }

  @PluginMethod
  public void open(PluginCall call) {
    try {
      Uri uri = Uri.parse(call.getString("reference", ""));
      if (!"content".equals(uri.getScheme())) throw new IOException("不是有效的文档引用。");
      InputStream input = getContext().getContentResolver().openInputStream(uri);
      if (input == null) throw new IOException("文件流不可用。");
      String token = UUID.randomUUID().toString();
      streams.put(token, new BufferedInputStream(input));
      call.resolve(new JSObject().put("token", token));
    } catch (Exception error) {
      call.reject("无法打开原文件。", error);
    }
  }

  @PluginMethod
  public void chunk(PluginCall call) {
    InputStream input = streams.get(call.getString("token", ""));
    if (input == null) {
      call.reject("文件读取已结束。");
      return;
    }
    try {
      byte[] buffer = new byte[CHUNK];
      int length = 0;
      while (length < buffer.length) {
        int read = input.read(buffer, length, buffer.length - length);
        if (read <= 0) break;
        length += read;
      }
      call.resolve(new JSObject().put("data", Base64.encodeToString(buffer, 0, length, Base64.NO_WRAP))
          .put("done", length < buffer.length));
    } catch (Exception error) {
      call.reject("读取文件失败。", error);
    }
  }

  private void closeStream(String token) {
    InputStream input = streams.remove(token);
    if (input != null) {
      try { input.close(); } catch (IOException ignored) {}
    }
  }

  @PluginMethod
  public void close(PluginCall call) {
    closeStream(call.getString("token", ""));
    call.resolve();
  }

  @PluginMethod
  public void release(PluginCall call) {
    try {
      getContext().getContentResolver().releasePersistableUriPermission(Uri.parse(call.getString("reference", "")), READ);
    } catch (SecurityException ignored) {
      // 提供方可能已经撤销了原文件的读取权限。
    }
    call.resolve();
  }

  @PluginMethod
  public void reading(PluginCall call) {
    boolean awake = Boolean.TRUE.equals(call.getBoolean("awake"));
    boolean keys = Boolean.TRUE.equals(call.getBoolean("volume"));
    getActivity().runOnUiThread(() -> {
      volume = awake && keys;
      if (awake) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
      else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
      call.resolve(new JSObject().put("volume", true));
    });
  }

  boolean handleVolume(KeyEvent event) {
    int key = event.getKeyCode();
    if (!volume || (key != KeyEvent.KEYCODE_VOLUME_UP && key != KeyEvent.KEYCODE_VOLUME_DOWN)) return false;
    if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
      notifyListeners("turn", new JSObject().put("step", key == KeyEvent.KEYCODE_VOLUME_UP ? 1 : -1));
    }
    return true;
  }

  @PluginMethod
  public void fonts(PluginCall call) {
    LinkedHashSet<String> families = new LinkedHashSet<>();
    for (String path : new String[] { "/system/etc/fonts.xml", "/product/etc/fonts_customization.xml" }) {
      try (InputStream input = new FileInputStream(path)) {
        XmlPullParser xml = Xml.newPullParser();
        xml.setInput(input, "UTF-8");
        while (xml.next() != XmlPullParser.END_DOCUMENT) {
          if (xml.getEventType() != XmlPullParser.START_TAG || !"family".equals(xml.getName())) continue;
          String family = xml.getAttributeValue(null, "name");
          if (family != null) families.add(family);
        }
      } catch (Exception ignored) {
        // 不同厂商的可选字体配置文件可能不存在。
      }
    }
    JSArray result = new JSArray();
    families.forEach(result::put);
    call.resolve(new JSObject().put("families", result));
  }

  @Override
  protected void handleOnDestroy() {
    for (String token : streams.keySet()) closeStream(token);
  }
}
