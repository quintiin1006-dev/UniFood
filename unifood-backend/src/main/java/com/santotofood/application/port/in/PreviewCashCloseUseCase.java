package com.santotofood.application.port.in;

import com.santotofood.application.model.CashViews;
import com.santotofood.domain.model.CashCount;
import java.util.UUID;

public interface PreviewCashCloseUseCase {
  CashViews.ClosePreview previewClose(UUID user, UUID sessionId, CashCount count);
}
