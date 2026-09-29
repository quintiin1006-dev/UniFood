package com.santotofood.adapter.in.web.mapper;

import com.santotofood.adapter.in.web.dto.InstitutionResponse;
import com.santotofood.domain.model.Institution;
import org.springframework.stereotype.Component;

@Component
public class InstitutionResponseMapper {

    public InstitutionResponse toResponse(
            Institution institution
    ) {

        return new InstitutionResponse(
                institution.getId(),
                institution.getName(),
                institution.getEmailDomain(),
                institution.getBrandName(),
                institution.isActive(),
                institution.getCreatedAt(),
                institution.getUpdatedAt()
        );
    }
}