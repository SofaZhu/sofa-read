package com.sofazhu.sofaread;

import android.os.Bundle;
import android.view.KeyEvent;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
  private final OnBackPressedCallback readerBack = new OnBackPressedCallback(false) {
    @Override
    public void handleOnBackPressed() {
      SofaNative plugin = readerPlugin();
      if (plugin != null) plugin.readerBack("swipe");
    }
  };

  @Override
  public void onCreate(Bundle state) {
    registerPlugin(SofaNative.class);
    super.onCreate(state);
    getOnBackPressedDispatcher().addCallback(this, readerBack);
  }

  void setReaderBackEnabled(boolean enabled) {
    readerBack.setEnabled(enabled);
  }

  private SofaNative readerPlugin() {
    if (getBridge() == null) return null;
    PluginHandle handle = getBridge().getPlugin("SofaNative");
    return handle != null && handle.getInstance() instanceof SofaNative
        ? (SofaNative) handle.getInstance() : null;
  }

  @Override
  public boolean dispatchKeyEvent(KeyEvent event) {
    SofaNative plugin = readerPlugin();
    if (plugin != null) {
      if (readerBack.isEnabled() && event.getKeyCode() == KeyEvent.KEYCODE_BACK) {
        if (event.getAction() == KeyEvent.ACTION_UP && !event.isCanceled()) plugin.readerBack("click");
        return true;
      }
      if (plugin.handleVolume(event)) return true;
    }
    return super.dispatchKeyEvent(event);
  }
}
