using System.Collections;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using System.Text.RegularExpressions;
using RotaryApi.Services;

namespace RotaryApi.Privacy;

/// <summary>
/// ROW member-data flags (master plan WS1-10, Appendix C): with <c>member.bloodGroup</c> off, every API response
/// carries blood group as null; with <c>member.familyDetails</c> off, family and spouse fields are null and family
/// lists empty. Applied once, to all JSON the API writes (typed DTOs, anonymous objects and Dapper rows), so no
/// endpoint can leak them. Both flags are off on ROW by default. Ids (familyId, familyMemberId) and the family
/// login switch are left as they are. Report files (Excel / Word) are handled where they are built.
/// </summary>
public static class MemberDataGuard
{
    // A blood-group value (bloodGroup, familyBloodGroup) — not a list named after it (bloodGroups).
    private static readonly Regex BloodGroup = new("^(family)?bloodgroup$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex Family = new(
        "^(family(members|details|photo|photopath|name|membername|relation|email|phone|mobile)|spouse(name|photo|dob))$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    /// <summary>What the value of a field with this name must become, or null when it may be written as is.</summary>
    private static Hidden? HiddenFor(string name)
    {
        if (!Brand.Feature("member.bloodGroup") && BloodGroup.IsMatch(name)) return Hidden.Null;
        if (!Brand.Feature("member.familyDetails") && Family.IsMatch(name)) return Hidden.Empty;
        return null;
    }

    private enum Hidden { Null, Empty }

    /// <summary>Adds the guard to the API's JSON options (Program.cs).</summary>
    public static void Apply(JsonSerializerOptions options)
    {
        var resolver = options.TypeInfoResolver ?? new DefaultJsonTypeInfoResolver();
        options.TypeInfoResolver = resolver.WithAddedModifier(GuardProperties);
        options.Converters.Add(new DapperRowConverterFactory());
    }

    /// <summary>Typed DTOs and anonymous objects: wrap the getter of a guarded property.</summary>
    private static void GuardProperties(JsonTypeInfo info)
    {
        if (info.Kind != JsonTypeInfoKind.Object) return;
        foreach (var p in info.Properties)
        {
            if (p.Get is not { } get) continue;
            var name = p.Name;
            if (!BloodGroup.IsMatch(name) && !Family.IsMatch(name)) continue;
            var type = p.PropertyType;
            p.Get = obj => HiddenFor(name) switch
            {
                null => get(obj),
                Hidden.Empty when type != typeof(string) && typeof(IEnumerable).IsAssignableFrom(type) => EmptyOf(type),
                _ => DefaultOf(type),
            };
        }
    }

    private static object? EmptyOf(Type type)
    {
        if (type.IsArray) return Array.CreateInstance(type.GetElementType()!, 0);
        if (!type.IsAbstract && !type.IsInterface && type.GetConstructor(Type.EmptyTypes) != null) return Activator.CreateInstance(type);
        if (type.IsGenericType && type.GetGenericArguments().Length == 1)
        {
            var list = typeof(List<>).MakeGenericType(type.GetGenericArguments()[0]);
            if (type.IsAssignableFrom(list)) return Activator.CreateInstance(list);
        }
        return null;
    }

    private static object? DefaultOf(Type type) => type.IsValueType && Nullable.GetUnderlyingType(type) == null ? Activator.CreateInstance(type) : null;

    /// <summary>
    /// Dapper's dynamic rows and string-keyed object dictionaries (many endpoints copy a row into a
    /// Dictionary&lt;string, object?&gt; before returning it): written as objects, guarded by key.
    /// </summary>
    private sealed class DapperRowConverterFactory : JsonConverterFactory
    {
        public override bool CanConvert(Type t) => IsRowLike(t);
        public override JsonConverter CreateConverter(Type t, JsonSerializerOptions o) =>
            (JsonConverter)Activator.CreateInstance(typeof(RowConverter<>).MakeGenericType(t))!;
    }

    private static bool IsRowLike(Type t) =>
        t.FullName == "Dapper.SqlMapper+DapperRow"
        || t == typeof(Dictionary<string, object?>) || t == typeof(Dictionary<string, object>)
        || t == typeof(System.Dynamic.ExpandoObject);

    private sealed class RowConverter<T> : JsonConverter<T>
    {
        /// <summary>Reading (a request body bound to Dictionary&lt;string, object&gt;) behaves as before: JsonElement values.</summary>
        public override T Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
        {
            if (typeToConvert != typeof(Dictionary<string, object?>) && typeToConvert != typeof(Dictionary<string, object>))
                throw new NotSupportedException($"{typeToConvert.Name} is written, never read.");
            using var doc = JsonDocument.ParseValue(ref reader);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) throw new JsonException("Expected a JSON object.");
            var dict = new Dictionary<string, object?>();
            foreach (var p in doc.RootElement.EnumerateObject()) dict[p.Name] = p.Value.Clone();
            return (T)(object)dict;
        }

        public override void Write(Utf8JsonWriter writer, T value, JsonSerializerOptions options) =>
            DapperRowConverter.WriteRow(writer, value!, options);
    }

    private static class DapperRowConverter
    {

        public static void WriteRow(Utf8JsonWriter writer, object value, JsonSerializerOptions options)
        {
            writer.WriteStartObject();
            foreach (var (key, v) in (IEnumerable<KeyValuePair<string, object?>>)value)
            {
                writer.WritePropertyName(options.DictionaryKeyPolicy?.ConvertName(key) ?? key);
                switch (HiddenFor(key))
                {
                    case null when v is null or DBNull:
                    case Hidden.Null:
                        writer.WriteNullValue();
                        break;
                    case Hidden.Empty:
                        writer.WriteNullValue();
                        break;
                    default:
                        JsonSerializer.Serialize(writer, v, v!.GetType(), options);
                        break;
                }
            }
            writer.WriteEndObject();
        }
    }
}
