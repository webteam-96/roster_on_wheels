class MemberAddressModel {
  final int? id;
  final String addressType; // 'Residential' | 'Business'
  final int? fkCountryId;
  final String? country;
  final String? state;
  final String? city;
  final String? pinCode;
  final String? address;
  final String? phoneNumber;
  // Business-only fields. Read-only on Residential rows.
  final String? businessName;
  final String? businessEmailId;
  final String? designation;
  final String? classificationProfession;
  final String? keywords;

  const MemberAddressModel({
    this.id,
    required this.addressType,
    this.fkCountryId,
    this.country,
    this.state,
    this.city,
    this.pinCode,
    this.address,
    this.phoneNumber,
    this.businessName,
    this.businessEmailId,
    this.designation,
    this.classificationProfession,
    this.keywords,
  });

  MemberAddressModel copyWith({
    int? fkCountryId,
    String? country,
    String? state,
    String? city,
    String? pinCode,
    String? address,
    String? phoneNumber,
    String? businessName,
    String? businessEmailId,
    String? designation,
    String? classificationProfession,
    String? keywords,
  }) {
    return MemberAddressModel(
      id: id,
      addressType: addressType,
      fkCountryId: fkCountryId ?? this.fkCountryId,
      country: country ?? this.country,
      state: state ?? this.state,
      city: city ?? this.city,
      pinCode: pinCode ?? this.pinCode,
      address: address ?? this.address,
      phoneNumber: phoneNumber ?? this.phoneNumber,
      businessName: businessName ?? this.businessName,
      businessEmailId: businessEmailId ?? this.businessEmailId,
      designation: designation ?? this.designation,
      classificationProfession:
          classificationProfession ?? this.classificationProfession,
      keywords: keywords ?? this.keywords,
    );
  }

  factory MemberAddressModel.fromJson(Map<String, dynamic> json) {
    return MemberAddressModel(
      id: json['id'] as int?,
      addressType: json['addressType'] as String? ?? 'Residential',
      fkCountryId: json['fkCountryId'] as int?,
      country: json['country'] as String?,
      state: json['state'] as String?,
      city: json['city'] as String?,
      pinCode: json['pinCode'] as String?,
      address: json['address'] as String?,
      phoneNumber: json['phoneNumber'] as String?,
      businessName: json['businessName'] as String?,
      businessEmailId: json['businessEmailId'] as String?,
      designation: json['designation'] as String?,
      // Some responses use `classification` (read), web POST uses
      // `classificationProfession`. Accept either when reading.
      classificationProfession:
          json['classificationProfession'] as String? ??
              json['classification'] as String?,
      keywords: json['keywords'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        if (id != null) 'id': id,
        'addressType': addressType,
        'fkCountryId': fkCountryId,
        'country': country,
        'state': state,
        'city': city,
        'pinCode': pinCode,
        'address': address,
        'phoneNumber': phoneNumber,
        'businessName': businessName,
        'businessEmailId': businessEmailId,
        'designation': designation,
        'classificationProfession': classificationProfession,
        'keywords': keywords,
      };
}

class FamilyMemberModel {
  final int? id;
  final String name;
  final String relation;
  final String? birthDate;
  final String? anniversaryDate;
  final String? contact;
  final String? email;
  final String? bloodGroup;
  final int? fkCountryId;
  final String? country;
  final String? countryPhoneCode;
  final String? photoPath;

  const FamilyMemberModel({
    this.id,
    required this.name,
    required this.relation,
    this.birthDate,
    this.anniversaryDate,
    this.contact,
    this.email,
    this.bloodGroup,
    this.fkCountryId,
    this.country,
    this.countryPhoneCode,
    this.photoPath,
  });

  FamilyMemberModel copyWith({
    String? name,
    String? relation,
    String? birthDate,
    String? anniversaryDate,
    String? contact,
    String? email,
    String? bloodGroup,
    int? fkCountryId,
    String? country,
    String? countryPhoneCode,
    String? photoPath,
  }) {
    return FamilyMemberModel(
      id: id,
      name: name ?? this.name,
      relation: relation ?? this.relation,
      birthDate: birthDate ?? this.birthDate,
      anniversaryDate: anniversaryDate ?? this.anniversaryDate,
      contact: contact ?? this.contact,
      email: email ?? this.email,
      bloodGroup: bloodGroup ?? this.bloodGroup,
      fkCountryId: fkCountryId ?? this.fkCountryId,
      country: country ?? this.country,
      countryPhoneCode: countryPhoneCode ?? this.countryPhoneCode,
      photoPath: photoPath ?? this.photoPath,
    );
  }

  factory FamilyMemberModel.fromJson(Map<String, dynamic> json) {
    return FamilyMemberModel(
      id: json['id'] as int?,
      name: json['name'] as String? ?? '',
      relation: json['relation'] as String? ?? '',
      birthDate: json['birthDate'] as String?,
      anniversaryDate: json['anniversaryDate'] as String?,
      // Backend serializes the family member's contact as `phoneNumber`/`emailId`
      // (matching the web frontend). Older code used `contact`/`email`, which the
      // API ignores — so read both, preferring the canonical keys.
      contact: json['phoneNumber'] as String? ?? json['contact'] as String?,
      email: json['emailId'] as String? ?? json['email'] as String?,
      bloodGroup: json['bloodGroup'] as String?,
      fkCountryId: json['fkCountryId'] as int?,
      country: json['country'] as String?,
      countryPhoneCode: json['countryPhoneCode'] as String?,
      photoPath: json['photoPath'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        if (id != null) 'id': id,
        'name': name,
        'relation': relation,
        'birthDate': birthDate,
        'anniversaryDate': anniversaryDate,
        // Backend expects `phoneNumber`/`emailId` for family members (matches the
        // web frontend). Sending `contact`/`email` was silently dropped → null.
        'phoneNumber': contact,
        'emailId': email,
        'bloodGroup': bloodGroup,
        // Omit when null so the backend FamilyMemberDto default (FkCountryId = 1)
        // applies. The DTO field is a NON-nullable int, so sending an explicit
        // null fails ASP.NET model binding with a 400 "One or more validation
        // errors occurred." — which only surfaced for members whose family rows
        // had no stored country. Mirrors the addresses fix (_addressJson).
        if (fkCountryId != null) 'fkCountryId': fkCountryId,
        'country': country,
        'countryPhoneCode': countryPhoneCode,
        'photoPath': photoPath,
      };
}

class MemberModel {
  final int id;
  final String memberName;
  final String? emailId;
  final int? fkPrimaryCountryId;
  final String? primaryCountry;
  final String? primaryCountryPhoneCode;
  final String? primaryMobileNumber;
  final int? fkSecondaryCountryId;
  final String? secondaryCountry;
  final String? secondaryCountryPhoneCode;
  final String? secondaryMobileNumber;
  final String? birthDate;
  final String? anniversaryDate;
  final String? bloodGroup;
  final String? gender;
  final String? primaryLanguage;
  final String? profilePhotoPath;
  final String? familyPhotoPath;
  final String? rotaryId;
  final String? donorRecognition;
  final String? memberIntroduction;
  final String? facebook;
  final String? instagram;
  final String? linkedIn;
  final String? twitter;
  final String? youtube;
  final String? website;
  final bool isPersonalDetailsVisible;
  final bool isFamilyDetailsVisible;
  final bool isHonoraryMember;
  final bool isYouth;
  // Member-level (club_members) attributes. The backend moved these OFF the
  // address object → top-level on the member DTO (Step 11B, 2026-06-18). The
  // Business tab still edits them, but they are read/written at the top level.
  final String? designation;
  final String? classificationProfession;
  final List<MemberAddressModel> addresses;
  final List<FamilyMemberModel> familyMembers;

  const MemberModel({
    required this.id,
    required this.memberName,
    this.emailId,
    this.fkPrimaryCountryId,
    this.primaryCountry,
    this.primaryCountryPhoneCode,
    this.primaryMobileNumber,
    this.fkSecondaryCountryId,
    this.secondaryCountry,
    this.secondaryCountryPhoneCode,
    this.secondaryMobileNumber,
    this.birthDate,
    this.anniversaryDate,
    this.bloodGroup,
    this.gender,
    this.primaryLanguage,
    this.profilePhotoPath,
    this.familyPhotoPath,
    this.rotaryId,
    this.donorRecognition,
    this.memberIntroduction,
    this.facebook,
    this.instagram,
    this.linkedIn,
    this.twitter,
    this.youtube,
    this.website,
    this.isPersonalDetailsVisible = true,
    this.isFamilyDetailsVisible = true,
    this.isHonoraryMember = false,
    this.isYouth = false,
    this.designation,
    this.classificationProfession,
    this.addresses = const [],
    this.familyMembers = const [],
  });

  factory MemberModel.fromJson(Map<String, dynamic> json) {
    final addresses = (json['addresses'] as List<dynamic>?)
            ?.map((e) => MemberAddressModel.fromJson(e as Map<String, dynamic>))
            .toList() ??
        const <MemberAddressModel>[];
    // Designation/Classification are now top-level (sourced from club_members).
    // Fall back to a Business address value only for legacy/list payloads that
    // still nest them, so older shapes keep working during the transition.
    MemberAddressModel? business;
    for (final a in addresses) {
      if (a.addressType == 'Business') {
        business = a;
        break;
      }
    }
    return MemberModel(
      id: json['id'] as int? ?? 0,
      memberName: json['memberName'] as String? ?? '',
      emailId: json['emailId'] as String?,
      fkPrimaryCountryId: json['fkPrimaryCountryId'] as int?,
      primaryCountry: json['primaryCountry'] as String?,
      primaryCountryPhoneCode: json['primaryCountryPhoneCode'] as String?,
      primaryMobileNumber: json['primaryMobileNumber'] as String?,
      fkSecondaryCountryId: json['fkSecondaryCountryId'] as int?,
      secondaryCountry: json['secondaryCountry'] as String?,
      secondaryCountryPhoneCode: json['secondaryCountryPhoneCode'] as String?,
      secondaryMobileNumber: json['secondaryMobileNumber'] as String?,
      birthDate: json['birthDate'] as String?,
      anniversaryDate: json['anniversaryDate'] as String?,
      bloodGroup: json['bloodGroup'] as String?,
      gender: json['gender'] as String?,
      primaryLanguage: json['primaryLanguage'] as String?,
      profilePhotoPath: json['profilePhotoPath'] as String?,
      familyPhotoPath: json['familyPhotoPath'] as String?,
      rotaryId: json['rotaryId'] as String?,
      donorRecognition: json['donorRecognition'] as String?,
      memberIntroduction: json['memberIntroduction'] as String?,
      facebook: json['facebook'] as String?,
      instagram: json['instagram'] as String?,
      linkedIn: json['linkedIn'] as String?,
      twitter: json['twitter'] as String?,
      youtube: json['youtube'] as String?,
      website: json['website'] as String?,
      isPersonalDetailsVisible:
          json['isPersonalDetailsVisible'] as bool? ?? true,
      isFamilyDetailsVisible: json['isFamilyDetailsVisible'] as bool? ?? true,
      isHonoraryMember: json['isHonoraryMember'] as bool? ?? false,
      isYouth: json['isYouth'] as bool? ?? false,
      designation:
          json['designation'] as String? ?? business?.designation,
      classificationProfession: json['classificationProfession'] as String? ??
          json['classification'] as String? ??
          business?.classificationProfession,
      addresses: addresses,
      familyMembers: (json['familyMembers'] as List<dynamic>?)
              ?.map((e) => FamilyMemberModel.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }

  Map<String, dynamic> toJson() => {
        'memberName': memberName,
        'emailId': emailId,
        'fkPrimaryCountryId': fkPrimaryCountryId,
        'primaryCountry': primaryCountry,
        'primaryCountryPhoneCode': primaryCountryPhoneCode,
        'primaryMobileNumber': primaryMobileNumber,
        'fkSecondaryCountryId': fkSecondaryCountryId,
        'secondaryCountry': secondaryCountry,
        'secondaryCountryPhoneCode': secondaryCountryPhoneCode,
        'secondaryMobileNumber': secondaryMobileNumber,
        'birthDate': birthDate,
        'anniversaryDate': anniversaryDate,
        'bloodGroup': bloodGroup,
        'gender': gender,
        'primaryLanguage': primaryLanguage,
        'profilePhotoPath': profilePhotoPath,
        'familyPhotoPath': familyPhotoPath,
        'rotaryId': rotaryId,
        'donorRecognition': donorRecognition,
        'memberIntroduction': memberIntroduction,
        'facebook': facebook,
        'instagram': instagram,
        'linkedIn': linkedIn,
        'twitter': twitter,
        'youtube': youtube,
        'website': website,
        'isPersonalDetailsVisible': isPersonalDetailsVisible,
        'isFamilyDetailsVisible': isFamilyDetailsVisible,
        'isHonoraryMember': isHonoraryMember,
        'isYouth': isYouth,
        'designation': designation,
        'classificationProfession': classificationProfession,
        'addresses': addresses.map((a) => a.toJson()).toList(),
        'familyMembers': familyMembers.map((f) => f.toJson()).toList(),
      };
}
