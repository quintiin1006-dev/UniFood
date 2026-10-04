package com.santotofood;

import com.santotofood.adapter.out.persistence.repository.SpringDataClientRepository;
import com.santotofood.adapter.out.persistence.repository.SpringDataInstitutionRepository;
import com.santotofood.adapter.out.persistence.repository.SpringDataOrderItemRepository;
import com.santotofood.adapter.out.persistence.repository.SpringDataOrderRepository;
import com.santotofood.adapter.out.persistence.repository.SpringDataSiteRepository;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

@SpringBootTest
@ActiveProfiles("test")
@TestPropertySource(locations = "classpath:application-test.properties")
@MockitoBean(
    types = {
      SpringDataClientRepository.class,
      SpringDataInstitutionRepository.class,
      SpringDataOrderItemRepository.class,
      SpringDataOrderRepository.class,
      SpringDataSiteRepository.class,
      JdbcTemplate.class,
      JwtDecoder.class
    })
class SantotofoodBackendApplicationTests {

  @Test
  void contextLoads() {}
}
