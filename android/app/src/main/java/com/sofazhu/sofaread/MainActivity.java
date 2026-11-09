package com.sofazhu.sofaread;

import android.os.Bundle;
import android.view.KeyEvent;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle state) {
    registerPlugin(SofaNative.class);
    super.onCreate(state);
  }

  @Override
  public boolean dispatchKeyEvent(KeyEvent event) {
    if (getBridge() != null) {
      PluginHandle handle = getBridge().getPlugin("SofaNative");
      if (handle != null && handle.getInstance() instanceof SofaNative &&
          ((SofaNative) handle.getInstance()).handleVolume(event)) return true;
    }
    return super.dispatchKeyEvent(event);
  }
}
