package com.santotofood.adapter.out.persistence.repository;

import com.santotofood.adapter.out.persistence.entity.InstitutionEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface SpringDataInstitutionRepository
        extends JpaRepository<InstitutionEntity, UUID> {

    @Query(value = """
        SELECT i.* FROM public.institutions i
        WHERE lower(i.email_domain) = public.canonical_institution_email_domain(:emailDomain)
        """, nativeQuery = true)
    Optional<InstitutionEntity> findByEmailDomain(@Param("emailDomain") String emailDomain);
}
