package jp.epoku.restmap;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.WebViewListener;
import android.webkit.WebView;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.Assert.*;

/** Integration checks against the bundled APK, not a development server. */
@RunWith(AndroidJUnit4.class)
public class OfflineFlowTest {
    private ActivityScenario<MainActivity> activity;

    private String js(String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        activity.onActivity(a -> a.getBridge().getWebView().evaluateJavascript(script, value -> { result.set(value); done.countDown(); }));
        assertTrue("WebView JS timed out", done.await(15, TimeUnit.SECONDS));
        return result.get();
    }

    private void until(String condition) throws Exception {
        long deadline = System.currentTimeMillis() + 45000;
        while (System.currentTimeMillis() < deadline) {
            if ("true".equals(js(condition))) return;
            Thread.sleep(200);
        }
        fail("Timed out: " + condition);
    }

    private void button(String text) throws Exception {
        js("Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '" + text + "')?.click()");
    }

    @Test
    public void bundledCityPostsRoutesAndNativeBack() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            activity = scenario;
            until("document.querySelector('.city-canvas')?.dataset.plateau === 'ready'");
            assertEquals("false", js("document.documentElement.scrollWidth > innerWidth"));
            assertEquals("\"peek\"", js("document.querySelector('.bottom-sheet').dataset.snap"));

            js("document.querySelector('.sheet-size').click()");
            until("document.querySelector('.bottom-sheet').dataset.snap === 'half'");
            activity.onActivity(a -> a.getOnBackPressedDispatcher().onBackPressed());
            until("document.querySelector('.bottom-sheet').dataset.snap === 'peek'");

            js("document.querySelector('.sheet-size').click()");
            until("document.querySelector('.bottom-sheet').dataset.snap === 'half'");
            js("document.querySelector('.sheet-size').click()");
            until("document.querySelector('.bottom-sheet').dataset.snap === 'full'");
            button("座れた");
            until("document.querySelector('.actual-report')?.textContent.includes('座れた') === true");
            js("document.querySelector('[aria-label=\"この場所を保存\"]')?.click()");
            until("document.querySelector('[aria-label=\"保存を解除\"]') !== null");
            button("ここへ行く（徒歩ルート）");
            until("document.querySelector('.route-summary')?.textContent.includes('徒歩 約') === true");
            activity.onActivity(a -> a.getOnBackPressedDispatcher().onBackPressed());
            until("document.querySelector('.route-summary') === null");

            // Wait for native navigation completion: the old DOM can still say "ready"
            // immediately after reload(), before the new document is committed.
            CountDownLatch reloaded = new CountDownLatch(1);
            WebViewListener listener = new WebViewListener() {
                @Override public void onPageLoaded(WebView view) { reloaded.countDown(); }
            };
            activity.onActivity(a -> { a.getBridge().addWebViewListener(listener); a.getBridge().getWebView().reload(); });
            assertTrue("Native reload did not finish", reloaded.await(45, TimeUnit.SECONDS));
            activity.onActivity(a -> a.getBridge().removeWebViewListener(listener));
            until("document.querySelector('.city-canvas')?.dataset.plateau === 'ready'");
            js("document.querySelector('.sheet-size').click()");
            until("document.querySelector('.actual-report')?.textContent.includes('座れた') === true");
            assertEquals("true", js("document.querySelector('[aria-label=\"保存を解除\"]') !== null"));
            assertEquals("false", js("document.documentElement.scrollWidth > innerWidth"));
        }
    }
}
