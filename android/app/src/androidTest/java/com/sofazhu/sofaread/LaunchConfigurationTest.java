package com.sofazhu.sofaread;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

import android.content.Context;
import android.content.Intent;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class LaunchConfigurationTest {
  @Test
  public void launchIntentOpensReaderActivity() {
    Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
    assertEquals("com.sofazhu.sofaread", context.getPackageName());
    Intent intent = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
    assertNotNull(intent);
    assertNotNull(intent.getComponent());
    assertEquals(MainActivity.class.getName(), intent.getComponent().getClassName());
  }
}
