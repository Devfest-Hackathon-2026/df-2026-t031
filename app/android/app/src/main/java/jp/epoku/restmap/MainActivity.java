package jp.epoku.restmap;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                getBridge().getWebView().evaluateJavascript(
                    "(() => { const active = !!document.querySelector('[data-back-active=true]'); if (active) window.dispatchEvent(new Event('epoku-back')); return active; })()",
                    result -> {
                        if ("false".equals(result)) moveTaskToBack(true);
                    }
                );
            }
        });
    }
}
